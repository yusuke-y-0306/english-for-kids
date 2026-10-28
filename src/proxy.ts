import { NextResponse, type NextRequest } from "next/server";
import {
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildCsp,
  createNonce,
} from "@/lib/security/csp";

/**
 * セキュリティヘッダ (issue #33)
 *
 * 値が固定のヘッダは next.config.ts の headers() にある。
 * ここでしか作れないのは **CSP** だけ:
 *  - nonce がリクエストごとに変わる
 *  - Next.js は request の CSP ヘッダから nonce を抜き出して自前の inline script に付ける
 *
 * Next.js 16 では middleware.ts が proxy.ts に改名された (middleware は非推奨)。
 */

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * 監査モード。`CSP_REPORT_ONLY=1` で「監視だけして止めない」状態になる。
 * 手順は docs/security-headers.md を参照。
 */
const reportOnly = process.env.CSP_REPORT_ONLY === "1";

/** http のまま動かすローカル確認で `upgrade-insecure-requests` が邪魔をしないようにする */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    development: isDevelopment,
    upgradeInsecureRequests: !isLoopbackHost(request.nextUrl.hostname),
  });

  const headerName = reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;

  const requestHeaders = new Headers(request.headers);
  // Next.js はこの request ヘッダを読んで nonce を inline script に付与する
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  return response;
}

export const config = {
  /**
   * HTML を返す経路だけを対象にする。
   *  - `api/`: JSON しか返さない (CSP は無意味)
   *  - `_next/static`, `_next/image`, `favicon.ico`: 静的なので nonce 不要
   * 値が固定のヘッダ (COOP/COEP など) は next.config.ts 側で全経路に付く。
   */
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
