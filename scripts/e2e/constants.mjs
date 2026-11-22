/**
 * E2E ハーネスの固定値。
 * `scripts/e2e/prepare.mjs` (Node が直接実行) と `playwright.config.ts`
 * (Playwright が読み込む) の両方から import するため、素の ESM で置く。
 *
 * ここにある値は **テスト専用**。本番の秘密と混ざらないよう、明らかに
 * テスト用と分かる文字列にしてある (長さ制約だけ満たす)。
 */

export const E2E_PORT = 3300;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** sessionSecret() は 32 文字以上を要求する */
export const SESSION_SECRET = "e2e-only-not-a-secret-0123456789abcdef";
/** masterKey() は base64 で 32 バイトを要求する */
export const MASTER_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

export const SESSION_COOKIE = "efk_session";
export const USER_ID = "u_e2etest0000000000";
export const USER_NAME = "テスト";

/** 端末指紋の判定を揺らさないため、UA は固定する (config の userAgent と一致させる) */
export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const DATA_DIR = ".e2e/data";
export const STATE_FILE = ".e2e/state.json";
export const REPORT_FILE = ".verify/e2e.json";
