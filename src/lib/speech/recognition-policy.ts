/**
 * 音声認識の経路決定 — issue #31 / #40
 *
 * このアプリの前提は「音声は端末の外に出さない」。したがって
 * **ローカル処理だと証明できた認識だけ**を使い、あいまいな実装は使わない。
 *
 * 経路は 3 つ:
 *  1. `device`      … ブラウザの音声認識を **端末内モードで** 使う (第一候補)
 *  2. `wasm`        … 自前のモデル (Moonshine) をブラウザ内で推論する (device の代替)
 *  3. `self-report` … 認識せず「いえた！」の自己申告 (最後の砦。通信ゼロ)
 *
 * `device` を選ぶ条件は「`SpeechRecognition` が存在し、`processLocally` を指定でき、
 * `available({ processLocally: true })` が `available` を返す」の 3 点すべて。
 * Safari の `webkitSpeechRecognition` は `processLocally` を持たないため **必ず** `self-report` に落ちる
 * (webkit 実装は事実上クラウドなので、使えば子どもの音声が Apple に渡る)。
 *
 * ## なぜ `device` を `wasm` より先にするのか (issue #40)
 *
 *  - **精度**: `device` は Google の端末内モデルで、学習データ量が桁違い。
 *    子ども・騒音・訛りへの頑健性は Moonshine tiny (27M パラメータ) より上と見るのが妥当。
 *    「言えたのに もういちど」と出る誤検出が、この機能で一番やってはいけないこと。
 *  - **初回コスト**: `device` はモデルの取得が要らない (端末に既にある)。
 *    `wasm` は初回に数十 MB を落とすので、使えるなら `device` のほうが速い。
 *  - ただし `device` は **使える保証がない** (Safari / Firefox / 言語パック未取得 /
 *    テスト用 Chromium には存在しない)。そこを `wasm` が埋める。
 *
 * どちらも「端末内であることを確認できた実装だけを使う」という不変条件は変えない。
 * クラウドに落ちる実装は、精度が高くても使わない。
 */

export type RecognitionPath = "wasm" | "device" | "self-report";

/**
 * `device` と `wasm` の**両方が使える**ときに、どちらを優先するか。
 * 既定は `device` (精度優先)。`wasm` を指定するのは計測用
 * (`public/lab/asr-bench/` — 同じ音声で 2 エンジンを比べるため)。
 */
export type PathPreference = "device" | "wasm";

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

/**
 * `device` 経路が使えない理由。使えるなら `null`。
 * 「なぜ使えないか」を子ども向けの短い文で返す (画面にそのまま出す)。
 */
function deviceBlocker(device: DeviceRecognitionReport): string | null {
  if (!device.present) {
    return "この端末では こえの よみとりが つかえません";
  }
  if (!device.hasProcessLocally) {
    // 曖昧な実装は「動けば使う」をしない (issue #31 の要)。
    return "この端末の よみとりは クラウドで おこなわれるため つかいません";
  }
  if (device.availability === "downloadable" || device.availability === "downloading") {
    return "端末内の よみとりデータが まだ ようい できていません";
  }
  if (device.availability !== "available") {
    return "端末内の よみとりが つかえません";
  }
  return null;
}

/** 経路を決める。純粋関数 (ブラウザ API は呼ばない) */
export function decideRecognitionPath(input: {
  wasmReady: boolean;
  device: DeviceRecognitionReport;
  prefer?: PathPreference;
}): PathDecision {
  const { wasmReady, device, prefer = "device" } = input;
  const blocker = deviceBlocker(device);
  const deviceReady = blocker === null;

  const wasmPath: PathDecision = { path: "wasm", reason: "アプリ内のモデルで 認識します" };
  const devicePath: PathDecision = {
    path: "device",
    reason: "端末内の よみとりで 認識します",
  };

  // `prefer` が効くのは「両方使える」ときだけ。片方しか使えないなら順序は関係ない。
  if (deviceReady && wasmReady) {
    return prefer === "wasm" ? wasmPath : devicePath;
  }
  if (deviceReady) {
    return devicePath;
  }
  if (wasmReady) {
    return wasmPath;
  }

  // どちらも使えない → 自己申告。理由は device 側の事情をそのまま出す
  // (子どもにとっては「認識できない」の 1 点しか違いがない)。
  return {
    path: "self-report",
    reason: blocker ?? "この端末では こえの よみとりが つかえません",
  };
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
