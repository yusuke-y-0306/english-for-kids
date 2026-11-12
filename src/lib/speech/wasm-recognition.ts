/**
 * 端末内 WASM 推論で 1 語を聞き取る — issue #79 (Safari 対応)
 *
 * Safari の `webkitSpeechRecognition` は `processLocally` を持たず、**必ずクラウド**で
 * 認識する。このアプリは「子どもの声を端末の外に出さない」が前提なので、Safari では
 * これまで自己申告しか選べなかった (#31)。ここでは自前のモデル (Moonshine) を
 * ブラウザ内で動かすことで、Safari でも **音声を送らずに** 発音練習を成立させる。
 *
 * 構成:
 *  - エンジン (`moonshine.mjs` + `moonshine.wasm`) は `public/asr/moonshine/` から
 *    同一オリジンで読む (`scripts/asr-engine.mjs` が npm 依存からコピー)。
 *  - モデル (51MB) は #29 の **検証済みキャッシュ** から `Uint8Array` で渡す。
 *    CDN も `AssetDownloader` も使わない (取得経路を 1 本に保つ)。
 *  - マイクは自前の AudioWorklet (`public/asr/capture-worklet.js`) で取り、16kHz に
 *    明示リサンプルする。Safari は `AudioContext({ sampleRate })` を尊重しないため、
 *    ハードウェアのサンプルレートから必ず変換する。
 *
 * このモジュールは **ブラウザ専用** (`window` / `AudioContext` を触る)。
 * 純粋な判定とリサンプルは `wasm-policy.ts` に置き、そちらを unit テストで固定する。
 */

import type { Stream, Transcriber, TranscriptEventListener } from "@moonshine-ai/moonshine-wasm";
import { ensureModels, isModelReady, loadVerifiedFiles } from "./model-cache";
import type { WasmReadiness } from "./recognition-policy";
import { TARGET_SAMPLE_RATE, resampleTo16k, wasmSupportBlocker } from "./wasm-policy";

export type { WasmReadiness } from "./recognition-policy";

/** 同一オリジンのエンジン配信先 (scripts/asr-engine.mjs と対) */
const ENGINE_URL = "/asr/moonshine/index.js";
/** 自前のキャプチャ用 worklet (Blob を使わない: CSP を緩めないため) */
const WORKLET_URL = "/asr/capture-worklet.js";
const WORKLET_NAME = "efk-capture";

/** 1 回の聞き取りの上限。子どもが黙っていても待ち続けない */
export const DEFAULT_LISTEN_TIMEOUT_MS = 8_000;

export type WasmSupport = {
  supported: boolean;
  /** 使えない理由 (子ども向けの短い文)。使えるなら null */
  reason: string | null;
};

/** いまのブラウザで端末内推論が使えるか (副作用なし) */
export function detectWasmSupport(): WasmSupport {
  const scope = globalThis as unknown as {
    WebAssembly?: unknown;
    SharedArrayBuffer?: unknown;
    crossOriginIsolated?: boolean;
    AudioContext?: unknown;
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  };
  const reason = wasmSupportBlocker({
    hasWebAssembly: typeof scope.WebAssembly === "object" && scope.WebAssembly !== null,
    hasSharedArrayBuffer: typeof scope.SharedArrayBuffer === "function",
    crossOriginIsolated: scope.crossOriginIsolated === true,
    hasGetUserMedia: typeof scope.navigator?.mediaDevices?.getUserMedia === "function",
    hasAudioContext: typeof scope.AudioContext === "function",
  });
  return { supported: reason === null, reason };
}

/** モデルまで含めた準備状態。UI はこれで「じゅんび」ボタンを出すか決める */
export async function detectWasmReadiness(): Promise<WasmReadiness> {
  if (!detectWasmSupport().supported) return "unsupported";
  return (await isModelReady()) ? "ready" : "needs-download";
}

type EngineModule = typeof import("@moonshine-ai/moonshine-wasm");

/**
 * エンジンを同一オリジンから動的 import する。
 *
 * パッケージをバンドルすると、Emscripten の `import('./moonshine.mjs')` と
 * pthread の `new Worker(new URL('moonshine.mjs', import.meta.url))` が
 * バンドラの chunk を指してしまい、実行時に 404 になる。素の ESM として
 * `/asr/moonshine/` から読めば、相対解決も worker もそのまま正しく動く。
 */
let enginePromise: Promise<EngineModule> | null = null;
function loadEngine(): Promise<EngineModule> {
  enginePromise ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ ENGINE_URL
  )
    .then((module) => module as EngineModule)
    .catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  return enginePromise;
}

let transcriberPromise: Promise<Transcriber> | null = null;

/**
 * 検証済みキャッシュのバイト列から Transcriber を作る (1 セッション 1 個)。
 *
 * `language` (カタログ) は渡さない。渡すと CDN 取得の経路が生まれるため、
 * 必ず `files` を渡してメモリ上のバイト列だけで構築する。
 */
function loadTranscriber(): Promise<Transcriber> {
  transcriberPromise ??= Promise.all([loadEngine(), loadVerifiedFiles()])
    .then(([engine, files]) =>
      engine.Transcriber.load({
        files,
        modelArch: engine.ModelArch.TinyStreaming,
      }),
    )
    .catch((error: unknown) => {
      transcriberPromise = null;
      throw error;
    });
  return transcriberPromise;
}

export type PrepareProgress = {
  /** 0..1。総バイト数が不明なら null (不定プログレス) */
  fraction: number | null;
  /** いま取得中のファイル名 */
  file: string | null;
  /** 合計バイト数と取得済みバイト数 */
  loaded: number;
  total: number;
};

export type PrepareOptions = {
  onProgress?: (progress: PrepareProgress) => void;
};

/**
 * 初回のじゅんび: モデルを検証つきで落としてからエンジンに読ませる。
 *
 * 51MB を勝手に落とさないよう、**呼び出し側の明示的な操作** (ボタン) から呼ぶ。
 * 途中で失敗してもキャッシュは壊れたままにならない (#29 の sentinel 方式)。
 */
export async function prepareWasm(options: PrepareOptions = {}): Promise<void> {
  await ensureModels({
    onProgress: (progress) => {
      options.onProgress?.({
        fraction: progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : null,
        file: progress.file,
        loaded: progress.loaded,
        total: progress.total,
      });
    },
  });
  /* ダウンロード後にエンジンへ読ませる (数秒かかる)。ここまで終わって「使える」 */
  await loadTranscriber();
}

export type WasmRecognitionErrorKind =
  /** 環境が対応していない (SAB / AudioContext 等) */
  | "unsupported"
  /** マイクが開けない (許可されない / 端末が無い) */
  | "mic"
  /** 何も聞き取れなかった */
  | "empty"
  /** 時間切れ */
  | "timeout"
  /** エンジン・モデルの読み込みや推論の失敗 */
  | "failed";

export class WasmRecognitionError extends Error {
  readonly kind: WasmRecognitionErrorKind;

  constructor(kind: WasmRecognitionErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WasmRecognitionError";
    this.kind = kind;
  }
}

export type ListenOptions = {
  timeoutMs?: number;
  /** 途中経過 (子どもには見せなくてよいが、親向けの手応えに使える) */
  onPartial?: (text: string) => void;
};

/**
 * マイクから 1 回だけ聞き取る。
 *
 * 流れ: マイク → AudioWorklet → 16kHz モノラル → `Stream.addAudio()` →
 * `Stream.transcribe()`。最初の「言い終わった行」が来たら成功。
 * 何も来なければ `timeoutMs` で打ち切り、途中までのテキストがあればそれを返す。
 *
 * 音声はどこにも送らない (この関数の中で完結する)。
 */
export async function listenOnceWithWasm(options: ListenOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LISTEN_TIMEOUT_MS;
  const support = detectWasmSupport();
  if (!support.supported) {
    throw new WasmRecognitionError("unsupported", support.reason ?? "端末内の よみとりが つかえません");
  }

  /* AudioContext は **ユーザー操作の直後** に作る。Safari は await を挟むと
     「操作が終わった」とみなして suspended のままにすることがある */
  const context = new AudioContext();
  let mediaStream: MediaStream | null = null;
  let stream: Stream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  /** 停止後に遅れて届く chunk を捨てる (閉じた stream に足すと VAD エラーになる) */
  let capturing = false;

  const cleanup = async () => {
    try {
      workletNode?.disconnect();
      scriptNode?.disconnect();
      sourceNode?.disconnect();
    } catch {
      // すでに切れている場合は無視
    }
    mediaStream?.getTracks().forEach((track) => track.stop());
    try {
      stream?.close();
    } catch {
      // close 済みなら無視
    }
    stream = null;
    await context.close().catch(() => undefined);
  };

  try {
    const transcriber = await loadTranscriber();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      throw new WasmRecognitionError("mic", "マイクが つかえませんでした", { cause: error });
    }

    if (context.state === "suspended") {
      /* 許可直後は操作が見えているので、ここでの resume は通る */
      await context.resume().catch(() => undefined);
    }

    const inputSampleRate = context.sampleRate;
    sourceNode = context.createMediaStreamSource(mediaStream);

    stream = transcriber.createStream();
    let heard = "";
    const streamRef = stream;

    const completed = new Promise<void>((resolve, reject) => {
      const listener: TranscriptEventListener = {
        onLineTextChanged: (event) => {
          const text = event.line.text?.trim() ?? "";
          if (text === "") return;
          heard = text;
          options.onPartial?.(text);
        },
        onLineCompleted: (event) => {
          const text = event.line.text?.trim() ?? "";
          if (text !== "") heard = text;
          resolve();
        },
        onError: (event) => reject(event.error),
      };
      streamRef.addListener(listener);
    });

    stream.start();
    capturing = true;

    const handleChunk = (chunk: Float32Array) => {
      if (!capturing || !stream) return;
      const resampled = resampleTo16k(chunk, inputSampleRate);
      stream.addAudio(resampled, TARGET_SAMPLE_RATE);
      stream.transcribe();
    };

    /* AudioWorklet が無い / 読み込めない端末では ScriptProcessor に落とす
       (Safari の古い版でも、音が取れないよりは遅い方がよい) */
    let workletReady = false;
    if (context.audioWorklet) {
      try {
        await context.audioWorklet.addModule(WORKLET_URL);
        /* 出力は使わないが、Safari は入力/出力の数を明示しないと構築に失敗することがある */
        workletNode = new AudioWorkletNode(context, WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => handleChunk(event.data);
        workletNode.connect(context.destination);
        sourceNode.connect(workletNode);
        workletReady = true;
      } catch {
        workletReady = false;
      }
    }
    if (!workletReady) {
      scriptNode = context.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = (event) => {
        handleChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      scriptNode.connect(context.destination);
      sourceNode.connect(scriptNode);
    }

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });

    try {
      await Promise.race([completed, timeout]);
    } finally {
      capturing = false;
      if (timer) clearTimeout(timer);
      try {
        stream.stop();
      } catch {
        // 停止済みなら無視
      }
    }

    const transcript = heard.trim();
    if (transcript === "") {
      throw timedOut
        ? new WasmRecognitionError("timeout", "きこえなかったよ")
        : new WasmRecognitionError("empty", "きこえなかったよ");
    }
    return transcript;
  } catch (error) {
    if (error instanceof WasmRecognitionError) throw error;
    throw new WasmRecognitionError("failed", "よみとりに しっぱいしました", { cause: error });
  } finally {
    await cleanup();
  }
}
