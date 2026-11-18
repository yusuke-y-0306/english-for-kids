/**
 * 端末内推論まわりの純粋な判定 — issue #79
 *
 * `wasm-recognition.ts` はブラウザ API (`AudioContext` / `navigator.mediaDevices`)
 * を触るので `node --test` から直接 import できない。**判定と計算だけ** をここに
 * 切り出して、Safari の境界 (SAB / cross-origin isolation / リサンプル) を
 * テストで固定する (`summary.ts` / `streak.ts` と同じ「依存を持たない純粋関数」の流儀)。
 */

/** モデルが期待するサンプルレート */
export const TARGET_SAMPLE_RATE = 16_000;

export type WasmEnvironment = {
  hasWebAssembly: boolean;
  hasSharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  hasGetUserMedia: boolean;
  hasAudioContext: boolean;
};

/**
 * 端末内推論が動く環境かを判定する。
 *
 * 既定ビルドのエンジンは **SIMD + マルチスレッド** なので `SharedArrayBuffer` が要り、
 * それは cross-origin isolation (COOP/COEP) が無いと公開されない。ここが false のまま
 * 推論すると、例外も出ずに無言で失敗するため、先に止める。
 */
export function wasmSupportBlocker(env: WasmEnvironment): string | null {
  if (!env.hasWebAssembly) return "この ブラウザでは アプリ内の よみとりが つかえません";
  if (!env.hasSharedArrayBuffer || !env.crossOriginIsolated) {
    return "この ページでは アプリ内の よみとりが つかえません";
  }
  if (!env.hasGetUserMedia) return "この ブラウザでは マイクが つかえません";
  if (!env.hasAudioContext) return "この ブラウザでは マイクの おとが とれません";
  return null;
}

/**
 * 16kHz モノラルへ線形リサンプルする。
 *
 * `@moonshine-ai/moonshine-wasm` の `resampleTo16k()` と同じ計算 (MIT)。
 * Safari は `AudioContext` のサンプルレート指定を無視して 44.1/48kHz で開くので、
 * ここを通さないとモデルが「別の速さの音」として聞いてしまう。
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE || inputRate <= 0) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

/** 事前読み込みの判断材料 (すべて純粋な値) */
export type WarmUpInput = {
  /** 端末内推論が使える環境か (`wasmSupportBlocker() === null`) */
  supported: boolean;
  /** モデルの準備状態 */
  readiness: "ready" | "needs-download" | "unsupported";
  /** このページですでにエンジンを読み込み済みか */
  loaded: boolean;
  /** 回線が節約モード (Save-Data) か */
  saveData?: boolean;
};

/**
 * アプリを開いた裏でモデルを読み込んでおくべきか — issue #2
 *
 * 発音練習のページを開いてから読み込むと、**子どもが 30〜60 秒待たされる**
 * (iPhone の実測で 40 秒超)。ホームを見ているあいだに済ませておく。
 *
 * ただし:
 *  - 51MB の**取得**は本人の操作から (準備できていないなら何もしない)
 *  - 環境が対応していない / すでに読み込み済みなら何もしない
 *  - Save-Data のときは遠慮する
 */
export function shouldWarmUpWasm(input: WarmUpInput): boolean {
  if (!input.supported) return false;
  if (input.readiness !== "ready") return false;
  if (input.loaded) return false;
  if (input.saveData) return false;
  return true;
}
