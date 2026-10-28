/**
 * Moonshine モデルのファイル一覧と sha256 — 自動生成 (scripts/models.mjs manifest --init)
 * 手で編集しないこと。更新は docs/speech-model-hosting.md の手順で行う。
 *
 * ここに固定された sha256 が「信頼の起点」。配信元 (別オリジン) は信頼しない前提で、
 * 読み込み前に必ず照合すること (issue #29)。
 */

/** 上流のモデル名 */
export const MODEL_NAME = "tiny-streaming-en";
/** 上流の量子化バリアント */
export const MODEL_VARIANT = "q8_2026-07-30";
/** ファイル集合の指紋 (sha256 の総和) */
export const MODEL_SET_HASH = "9364da5be8bd44b52f5d5d7e996b914373d596e95b561d067dfa10e9f915cdd3";
/** 配信先のパス接頭辞 (バージョン + 指紋の先頭 8 文字) */
export const MODEL_PATH_PREFIX = "models/tiny-streaming-en/q8_2026-07-30-9364da5b";
/** 合計バイト数 */
export const MODEL_TOTAL_BYTES = 51441771;

export const MODEL_FILES = {
  "adapter.ort": { bytes: 1319664, sha256: "22ecc949e146c49667fda28d102d4e30749a107dc88a396292aa8f277ef1347c" },
  "cross_kv.ort": { bytes: 1287544, sha256: "143a36667b8d05fd9d04e8c337b7ee121f37ef299aea6b3d82bdb3d3401950b4" },
  "decoder_kv.ort": { bytes: 32583720, sha256: "8852553f312adb6c9aa4d17418015049b30f412209ee569d336548c0044627de" },
  "encoder.ort": { bytes: 7675440, sha256: "a8414e1a5dedf9f2093d7680601dd8a9b0433e7020260eafe0e370ead91134ca" },
  "frontend.ort": { bytes: 8324920, sha256: "271a563251f11e6311949530f8025ed4d345c5d69d4ac1efa74093779927d636" },
  "streaming_config.json": { bytes: 509, sha256: "74fe5ddebd63b17caf59e8a3b18c17547ff7bce1642050edbb1c3962674f8950" },
  "tokenizer.bin": { bytes: 249974, sha256: "6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d" },
} as const;

export type ModelFileName = keyof typeof MODEL_FILES;
