/**
 * 音声認識の経路決定 — issue #31
 *
 * このアプリの前提は「音声は端末の外に出さない」。したがって
 * **ローカル処理だと証明できた認識だけ**を使い、あいまいな実装は使わない。
 *
 * 経路は 3 つ:
 *  1. `wasm`        … 自前のモデル (Moonshine) をブラウザ内で推論する (第一候補)
 *  2. `device`      … ブラウザの音声認識を **端末内モードで** 使う
 *  3. `self-report` … 認識せず「いえた！」の自己申告 (最後の砦。通信ゼロ)
 *
 * `device` を選ぶ条件は「`SpeechRecognition` が存在し、`processLocally` を指定でき、
 * `available({ processLocally: true })` が `available` を返す」の 3 点すべて。
 * Safari の `webkitSpeechRecognition` は `processLocally` を持たないため **必ず** `self-report` に落ちる
 * (webkit 実装は事実上クラウドなので、使えば子どもの音声が Apple に渡る)。
 */

export type RecognitionPath = "wasm" | "device" | "self-report";

/** `SpeechRecognition.available({ processLocally })` の戻り値 */
export type DeviceAvailability =
  | "available"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "error";

export type DeviceRecognitionReport = {
  /** コンストラクタが存在するか */
  present: boolean;
  /**
   * `processLocally` を指定できる実装か。
   * これが false の実装 (Safari 等) は「常にクラウド」なので使わない。
   */
  hasProcessLocally: boolean;
  /** `available()` の結果。`available()` が無い実装では undefined */
  availability?: DeviceAvailability;
};

export type PathDecision = {
  path: RecognitionPath;
  /** 画面にそのまま出せる短い理由 */
  reason: string;
};

/** 経路を決める。純粋関数 (ブラウザ API は呼ばない) */
export function decideRecognitionPath(input: {
  wasmReady: boolean;
  device: DeviceRecognitionReport;
}): PathDecision {
  const { wasmReady, device } = input;

  if (wasmReady) {
    return { path: "wasm", reason: "端末内のモデルで認識します" };
  }
  if (!device.present) {
    return { path: "self-report", reason: "この端末では こえの よみとりが つかえません" };
  }
  if (!device.hasProcessLocally) {
    // ここが本 issue の要。曖昧な実装は「動けば使う」をしない。
    return {
      path: "self-report",
      reason: "この端末の よみとりは クラウドで おこなわれるため つかいません",
    };
  }
  if (device.availability !== "available") {
    return {
      path: "self-report",
      reason:
        device.availability === "downloadable" || device.availability === "downloading"
          ? "端末内の よみとりデータが まだ ようい できていません"
          : "端末内の よみとりが つかえません",
    };
  }
  return { path: "device", reason: "端末内の よみとりで 認識します" };
}

/**
 * `device` 経路を継続できないエラーか。
 * これらが出たら **リトライしない**。クラウドに落ちる実装があるため、
 * そのまま自己申告モードへ切り替える。
 */
export const FATAL_DEVICE_ERRORS = [
  "language-not-supported",
  "network",
  "service-not-allowed",
  "not-allowed",
] as const;

export function isFatalDeviceError(code: string | undefined): boolean {
  return !!code && (FATAL_DEVICE_ERRORS as readonly string[]).includes(code);
}
