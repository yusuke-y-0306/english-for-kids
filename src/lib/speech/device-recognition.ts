/**
 * ブラウザの音声認識を「端末内モード」でのみ使うラッパー — issue #31
 *
 * 守っていること:
 *  - コンストラクタを直接 export しない。`createDeviceRecognizer()` を通さない限り
 *    インスタンスを作れない (processLocally を付け忘れた経路を型で潰す)
 *  - `processLocally = true` を代入したあと、実装が実際に保持しているか確認する。
 *    握り潰される実装では起動しない
 *  - 失敗時はリトライしない。呼び出し側は `self-report` に切り替える
 */

import {
  decideRecognitionPath,
  isFatalDeviceError,
  type DeviceAvailability,
  type DeviceRecognitionReport,
  type PathDecision,
  type PathPreference,
} from "./recognition-policy";

export const DEVICE_RECOGNITION_LANG = "en-US";

/** 認識セッションの結果 */
export type DeviceRecognitionResult = { transcript: string };

export type DeviceRecognitionFailure =
  /** 端末内と証明できないので使わない (呼び出し側は self-report へ) */
  | { kind: "not-local"; reason: string }
  /** 端末内認識がエラーを返した。リトライ禁止 */
  | { kind: "failed"; code: string }
  /** 何も聞き取れなかった */
  | { kind: "empty" }
  /** 時間切れ */
  | { kind: "timeout" };

export class DeviceRecognitionError extends Error {
  readonly failure: DeviceRecognitionFailure;

  constructor(failure: DeviceRecognitionFailure) {
    super(failure.kind === "failed" ? `device recognition failed: ${failure.code}` : failure.kind);
    this.name = "DeviceRecognitionError";
    this.failure = failure;
  }
}

/** ブラウザ実装の最小インターフェース (DOM の型定義に依存しない) */
type RecognitionEventLike = {
  results?: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
  resultIndex?: number;
  error?: string;
};
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = {
  new (): RecognitionLike;
  available?: (options: { langs?: string[]; processLocally?: boolean }) => unknown;
};

function getCtor(): RecognitionCtor | undefined {
  const scope = globalThis as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** `available()` が返らない実装でも UI を止めないための上限 */
const AVAILABILITY_TIMEOUT_MS = 1500;

async function readAvailability(ctor: RecognitionCtor): Promise<DeviceAvailability | undefined> {
  if (typeof ctor.available !== "function") return undefined;
  try {
    // Chrome は Promise を返すが、同期で返す実装もありうるので await で吸収する。
    // 返らない実装に備えて必ずタイムアウトを付ける (判定できない = 使わない)。
    const value = await Promise.race([
      Promise.resolve(
        ctor.available({ langs: [DEVICE_RECOGNITION_LANG], processLocally: true }),
      ),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), AVAILABILITY_TIMEOUT_MS),
      ),
    ]);
    const normalized = String(value) as DeviceAvailability;
    return ["available", "unavailable", "downloadable", "downloading"].includes(normalized)
      ? normalized
      : "unavailable";
  } catch {
    return "error";
  }
}

/** 端末内認識が使えるかを調べる (副作用なし) */
export async function detectDeviceRecognition(): Promise<DeviceRecognitionReport> {
  const ctor = getCtor();
  if (!ctor) return { present: false, hasProcessLocally: false };
  // processLocally は WebIDL の属性なので prototype 側で判定できる。
  // インスタンスを作らずに済むうえ、「生成しただけで何か始まる」実装にも触れない。
  // (prototype に無い実装は「クラウドでしか動かない」とみなして使わない = fail closed)
  const hasProcessLocally = "processLocally" in ctor.prototype;
  if (!hasProcessLocally) return { present: true, hasProcessLocally: false };
  return {
    present: true,
    hasProcessLocally: true,
    availability: await readAvailability(ctor),
  };
}

export type RecognitionDecision = PathDecision & { report: DeviceRecognitionReport };

/**
 * wasm が使えるかと端末内認識の可否から経路を決める。
 *
 * `prefer` は**両方使える**ときの優先順位 (既定 `device`)。
 * 計測ページだけが `wasm` を渡して、同じ音声で 2 エンジンを比べる (issue #40)。
 */
export async function resolveRecognitionDecision(
  wasmReady: boolean,
  prefer: PathPreference = "device",
): Promise<RecognitionDecision> {
  const report = await detectDeviceRecognition();
  return { ...decideRecognitionPath({ wasmReady, device: report, prefer }), report };
}

/**
 * 端末内認識のインスタンスを作る。`device` 経路と決まった場合以外は例外。
 * ここを通らない限り SpeechRecognition は生成されない。
 */
export function createDeviceRecognizer(decision: PathDecision): RecognitionLike {
  if (decision.path !== "device") {
    throw new DeviceRecognitionError({ kind: "not-local", reason: decision.reason });
  }
  const ctor = getCtor();
  if (!ctor) {
    throw new DeviceRecognitionError({ kind: "not-local", reason: "認識 API がありません" });
  }
  const recognizer = new ctor();
  recognizer.processLocally = true;
  // 実装が握り潰していないか確認する。ここで false なら「クラウドで動く」実装なので使わない。
  if (recognizer.processLocally !== true) {
    throw new DeviceRecognitionError({
      kind: "not-local",
      reason: "端末内モードを指定できませんでした",
    });
  }
  recognizer.lang = DEVICE_RECOGNITION_LANG;
  recognizer.continuous = false;
  recognizer.interimResults = false;
  return recognizer;
}

/**
 * 1 回だけ聞き取る。失敗しても **リトライしない**。
 * @throws DeviceRecognitionError
 */
export function listenOnce(recognizer: RecognitionLike, timeoutMs = 8000): Promise<DeviceRecognitionResult> {
  return new Promise<DeviceRecognitionResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      try {
        recognizer.stop();
      } catch {
        // すでに止まっている場合は無視
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new DeviceRecognitionError({ kind: "timeout" })));
    }, timeoutMs);

    recognizer.onresult = (event) => {
      const results = event.results;
      let transcript = "";
      if (results) {
        for (let i = event.resultIndex ?? 0; i < results.length; i += 1) {
          const alternative = results[i]?.[0];
          if (alternative?.transcript) transcript += alternative.transcript;
        }
      }
      const text = transcript.trim();
      if (!text) {
        finish(() => reject(new DeviceRecognitionError({ kind: "empty" })));
        return;
      }
      finish(() => resolve({ transcript: text }));
    };

    recognizer.onerror = (event) => {
      const code = event.error ?? "unknown";
      // クラウドに落ちる可能性のあるエラーはそのまま自己申告へ。リトライしない。
      finish(() => reject(new DeviceRecognitionError({ kind: "failed", code })));
    };

    recognizer.onend = () => {
      finish(() => reject(new DeviceRecognitionError({ kind: "empty" })));
    };

    try {
      recognizer.start();
    } catch (error) {
      finish(() =>
        reject(
          new DeviceRecognitionError({
            kind: "failed",
            code: (error as { name?: string } | null)?.name ?? "start-failed",
          }),
        ),
      );
    }
  });
}

/** 自己申告モードへ落とすべきか (エラー種別から判断) */
export function shouldFallBackToSelfReport(error: unknown): boolean {
  if (!(error instanceof DeviceRecognitionError)) return true;
  if (error.failure.kind === "not-local") return true;
  if (error.failure.kind === "failed") return isFatalDeviceError(error.failure.code);
  return true;
}
