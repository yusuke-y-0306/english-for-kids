/**
 * Content-Security-Policy の組み立て (issue #33)
 *
 * なぜ next.config.ts ではなく proxy.ts で作るのか:
 *  - Next.js の App Router は HTML に **inline script** (`self.__next_f.push(...)`) を埋め込む。
 *    `script-src 'self'` だけではこれが実行できず、アプリがハイドレートしない。
 *    `'unsafe-inline'` を足すと CSP の意味がほぼ消えるので、**nonce** を使う。
 *  - nonce はリクエストごとに変わるため、静的な headers() では表現できない。
 *    Next.js は **request の CSP ヘッダ**から nonce を読み取り、自前の script に付与する。
 *
 * ここは「純粋な文字列生成」だけを置く (I/O なし)。proxy からもテストからも呼べる。
 */

import { MODEL_PATH_PREFIX } from "@/lib/speech/model-manifest";
import { MODEL_ORIGIN } from "@/lib/speech/model-origin";

/** 本番の CSP ヘッダ名 */
export const CSP_HEADER = "Content-Security-Policy";
/** 監査用 (report-only) の CSP ヘッダ名 */
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * 本番のモデル配信元を **モデルのディレクトリまで** 絞った CSP source。
 * 末尾の `/` は必須: CSP のパス一致は「末尾が / なら前方一致、そうでなければ完全一致」
 * なので、`/english-for-kids` と書くと `/english-for-kids/models/...` には**一致しない**。
 * バージョン (指紋付き) も含めて絞るので、モデルを更新すれば CSP も自動で追従する。
 */
const MODEL_CSP_SOURCE = `${MODEL_ORIGIN}/${MODEL_PATH_PREFIX}/`;

export type CspOptions = {
  /** リクエストごとの nonce */
  nonce: string;
  /** 開発サーバか (HMR 用の緩和を入れる) */
  development: boolean;
  /** `upgrade-insecure-requests` を付けるか (https で配信されているときだけ) */
  upgradeInsecureRequests: boolean;
};

/** CSP 用の nonce (16 バイトの乱数を hex で表現。nonce-source に使える文字だけ) */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * CSP を組み立てる。
 *
 * 方針:
 *  - `default-src 'self'` から全部落とす (deny by default)
 *  - `script-src` は **nonce + 'self'**。`'unsafe-inline'` は入れない
 *  - `'wasm-unsafe-eval'` は WASM (音声モデルの推論) に必須。
 *    忘れると**無言で**推論だけが死ぬ (例外も出ずコンソールに 1 行出るだけ) ので、
 *    ヘッダのスモークテスト (scripts/check-headers.mjs) で存在を固定している
 *  - `connect-src` は **'self' + モデル配信元だけ**。これが「音声もテキストも外部に
 *    送っていない」ことの機械的な証明になる (issue #2 レビュー 高-3)
 *  - `frame-ancestors 'none'` (X-Frame-Options は古いブラウザ用のフォールバック)
 */
export function buildCsp({ nonce, development, upgradeInsecureRequests }: CspOptions): string {
  const connectSrc = ["'self'", MODEL_CSP_SOURCE];
  if (development) {
    // 開発時のみ: ローカルで立ち上げた dev サーバの WebSocket (HMR) を許可する。
    // モデルは MODEL_CSP_SOURCE が NODE_ENV に応じて dev のオリジンになるので追加不要。
    connectSrc.push("ws://127.0.0.1:*", "ws://localhost:*");
  }

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'wasm-unsafe-eval'"];
  if (development) {
    // dev サーバの HMR (eval ベースの変換) を通すため。本番では付けない。
    scriptSrc.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // inline の onclick 等を禁止 (React は addEventListener なので影響しない)
    "script-src-attr 'none'",
    // Tailwind / Next が style を inline で差し込むため unsafe-inline が必要 (実測)
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}
