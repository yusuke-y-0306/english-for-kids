import type { NextConfig } from "next";

/**
 * セキュリティヘッダ (issue #33)
 *
 * **値が固定のヘッダだけ**をここに置く。CSP は nonce がリクエストごとに変わるため
 * proxy.ts で生成する (そちらに理由を書いてある)。
 *
 * COOP/COEP について:
 *  - これは「セキュリティヘッダ」ではなく **実行要件** (SharedArrayBuffer / WASM 推論のため)。
 *    cross-origin isolation を有効にすると、万一 XSS を許したときに攻撃者が使える武器が増える
 *    (SharedArrayBuffer + 高精度タイマー)。だからこそ CSP とセットで入れる。
 *  - `require-corp` を選ぶ理由: `credentialless` は Safari が対応していない。
 *    モデルは GitHub Pages から **CORS で取得**しているので、ACAO: * があれば
 *    require-corp でも通る (実際に通ることは docs/security-headers.md の手順で確認する)。
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    // frame-ancestors 'none' のフォールバック (frame-ancestors を知らない古いブラウザ用)
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // 発音練習でマイクだけ使う。他のデバイスは明示的に塞ぐ。
    key: "Permissions-Policy",
    value:
      "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
  {
    // 他サイトから画像/フォント等を読み込ませない (COEP require-corp と対になる)
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  // サーバの種類を晒さない
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
