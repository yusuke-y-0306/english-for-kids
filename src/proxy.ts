import { NextResponse, type NextRequest } from "next/server";
import {
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildCsp,
  createNonce,
} from "@/lib/security/csp";
import { denialFor, evaluateRoute, isApiPath } from "@/lib/auth/gate";
import { checkRequestSession } from "@/lib/auth/verify";

/**
 * リクエストの入口 — **(1) 認可の強制 (2) セキュリティヘッダ**
 *
 * ## 1. 認可は default-deny
 *
 * 個人情報を出す前にセッションを検証する、という規則をここで **一箇所** に集約する。
 * `gate.ts` の allowlist に載っている経路だけが素通りし、それ以外は全て
 * 署名・期限・ユーザー存在を検証される。新しいページや API を足したときに
 * 開発者が何もしなくても **守られる**（守り忘れという失敗の仕方を消す）。
 *
 * ここで閉じないもの:
 *  - 静的資産 / Next.js の内部 (`/_next/`, `/favicon.ico`)
 *  - ログイン手続き (`/login`, `/api/auth/login/*`, `/api/auth/setup/*`)
 *  - `logout` (cookie を消すだけ)
 *
 * 二重の防御として、各 Route Handler も `requireUser()` を通す。proxy が
 * 唯一の壁だと、proxy の設定ミスがそのまま全公開になるため。
 *
 * ## 2. CSP (issue #33)
 *
 * 値が固定のヘッダは next.config.ts の headers() にある。
 * ここでしか作れないのは CSP だけ:
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * CSP は **認可より先に** 組み立てる。
   * 未ログインで /login へ返す 307 にもヘッダを付けたいため
   * (「このアプリが出す HTML 系の応答には必ず CSP が付く」を例外なしにする)。
   */
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    development: isDevelopment,
    upgradeInsecureRequests: !isLoopbackHost(request.nextUrl.hostname),
  });

  const headerName = reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
  const isApi = isApiPath(pathname);

  /** HTML 系の応答には漏れなく CSP を付ける (JSON には意味が無いので付けない) */
  const withCsp = <T extends NextResponse>(response: T): T => {
    if (!isApi) response.headers.set(headerName, csp);
    return response;
  };

  /* ---------- 1. 認可 (default-deny) ---------- */

  if (evaluateRoute(pathname) === "session") {
    const session = await checkRequestSession((name) => request.cookies.get(name)?.value);

    if (!session.ok) {
      const denial = denialFor(pathname);
      if (denial.kind === "json") {
        return NextResponse.json(
          { ok: false, error: "ログインが必要です" },
          { status: denial.status, headers: { "cache-control": "no-store" } },
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = denial.to;
      url.search = "";
      return withCsp(
        NextResponse.redirect(url, {
          // 認可の結果を CDN / ブラウザに覚えさせない (ログイン後に古い 307 を掴まない)
          headers: { "cache-control": "no-store" },
        }),
      );
    }
  }

  /* ---------- 2. CSP ---------- */

  const requestHeaders = new Headers(request.headers);
  // Next.js はこの request ヘッダを読んで nonce を inline script に付与する
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withCsp(response);
}

export const config = {
  /**
   * **認可を掛けるために `api/` も対象にする** (以前は CSP の都合で除外していた)。
   * 個人情報を含む JSON を返すのは API なので、ここを外すと入口の門番がいなくなる。
   *
   * 除外するのは「リクエストごとに何も変えなくてよい静的資産」だけ。
   *  - `_next/static`, `_next/image`: ビルド成果物
   */
  matcher: ["/((?!_next/static|_next/image).*)"],
};
