import { NextResponse, type NextRequest } from "next/server";
import {
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  buildCsp,
  createNonce,
} from "@/lib/security/csp";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/config";
import { denialFor, evaluateRoute, isApiPath } from "@/lib/auth/gate";
import { issueSessionToken } from "@/lib/auth/token";
import { bindingOf } from "@/lib/auth/ua";
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
 * さらに **cookie を端末に紐付ける** (issue #53)。
 *  `efk_session` には発行時の `User-Agent` の指紋が入っており、種類が変わった
 *  リクエストは通さない。ブラウザ更新程度の揺れは「通して cookie を再発行」で
 *  自己修復させる（詳細は `lib/auth/ua.ts`）。
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

/** cookie の `Secure` を付けるか (session.ts の isSecureRequest と同じ判定) */
function isSecureRequest(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return !isLoopbackHost(request.nextUrl.hostname);
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

  /** 通すが cookie を発行し直したい (legacy / drift) ときに立てる */
  let rebind: { uid: string } | null = null;

  if (evaluateRoute(pathname) === "session") {
    const ua = request.headers.get("user-agent");
    const session = await checkRequestSession((name) => request.cookies.get(name)?.value, { ua });

    if (!session.ok) {
      /*
       * 端末が変わったときだけは理由を伝える (issue #53)。
       * 子どもは「なぜログイン画面に戻されたか」が分からないと固まるので、
       * /login 側で「ブラウザが かわったみたい」と案内する。
       */
      const reason = session.reason === "ua-mismatch" ? "ua_changed" : "";
      const denial = denialFor(pathname);
      if (denial.kind === "json") {
        return NextResponse.json(
          { ok: false, error: "ログインが必要です", ...(reason ? { code: reason } : {}) },
          { status: denial.status, headers: { "cache-control": "no-store" } },
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = denial.to;
      url.search = reason ? `?reason=${reason}` : "";
      return withCsp(
        NextResponse.redirect(url, {
          // 認可の結果を CDN / ブラウザに覚えさせない (ログイン後に古い 307 を掴まない)
          headers: { "cache-control": "no-store" },
        }),
      );
    }

    /*
     * ブラウザ更新などで UA が変わっただけなら、セッションは続けて
     * 新しい指紋で cookie を発行し直す（自己修復）。
     * 古い cookie (ua 無し) もここで移行するので、既存の家族をログアウトさせない。
     */
    if (session.rebind) {
      rebind = { uid: session.session.uid };
      console.warn("[auth] 端末の指紋が変わりました。セッションを再発行します", {
        uid: session.session.uid,
        reason: session.rebind,
        deviceClass: bindingOf(ua).uc,
      });
    }
  }

  /* ---------- 2. CSP ---------- */

  const requestHeaders = new Headers(request.headers);
  // Next.js はこの request ヘッダを読んで nonce を inline script に付与する
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  /* 端末の指紋が変わっていたら、いまのリクエストの UA で cookie を更新する */
  if (rebind) {
    response.cookies.set(
      SESSION_COOKIE,
      issueSessionToken(rebind.uid, bindingOf(request.headers.get("user-agent"))),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(request),
        path: "/",
        maxAge: SESSION_MAX_AGE_SEC,
      },
    );
  }

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
