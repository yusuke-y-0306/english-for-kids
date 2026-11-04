/**
 * 認可の入口 — **default-deny の allowlist**
 *
 * このアプリの個人情報は「セッションを検証したあと」にしか出してはいけない。
 * その判断を各ページ / 各 Route Handler に任せると、置き忘れがそのまま漏洩になる
 * （実際 `GET /api/auth/users` が認可なしで家族全員を返していた — issue #54）。
 *
 * そこで **proxy.ts が全リクエストの入口で判断する**。ここに載っていない経路は
 * すべて「セッション必須」になる。新しいページや API を追加したとき、
 * 何もしなければ **守られる**（守り忘れる余地を構造として消す）。
 *
 * 追加するときの心得:
 *  - `PUBLIC_*` に足すのは「個人に属する情報を一切返さない」と断言できる経路だけ
 *  - 末尾に `reason` を必ず書く。書けないなら公開してはいけない
 *  - `public()` は本人のものでも個人情報。ログイン前に出さない
 */

export type RouteAccess = "public" | "session";

export type PublicRoute = {
  /** 完全一致のパス、または前方一致の接頭辞 */
  readonly path: string;
  /** なぜ公開してよいのか。ここが書けないものは公開しない */
  readonly reason: string;
};

/** 完全一致で公開する経路 */
export const PUBLIC_EXACT: readonly PublicRoute[] = [
  {
    path: "/login",
    reason: "ログイン画面そのもの。ここを閉じると誰も入れなくなる",
  },
  {
    path: "/api/auth/logout",
    reason: "cookie を消すだけで個人情報を返さない。セッションが死んでいても叩ける必要がある",
  },
  {
    path: "/api/auth/revoke",
    reason:
      "本人のセッション、または おうちの 合言葉を確かめてから失効する。合言葉が違えば 403 (issue #52)",
  },
  {
    path: "/api/auth/devices",
    reason:
      "おうちの 合言葉を確かめてから、その子の端末一覧 (UA ハッシュ) だけを返す (issue #52)",
  },
] as const;

/** 前方一致で公開する経路 */
export const PUBLIC_PREFIX: readonly PublicRoute[] = [
  {
    path: "/api/auth/login/",
    reason: "ログイン手続き (challenge 発行 / 検証)。まだセッションが無い状態で通す必要がある",
  },
  {
    path: "/api/auth/setup/",
    reason: "初回設定。個人情報を返す経路 (children) は合言葉を別途検証してから返す",
  },
  {
    path: "/_next/",
    reason: "ビルド成果物 (JS / CSS / 画像)。個人情報を含まない",
  },
  {
    path: "/favicon.ico",
    reason: "favicon",
  },
  {
    path: "/lab/",
    reason: "ASR の計測ハーネス (静的ファイル)。個人情報を扱わない開発用ツール",
  },
] as const;

/** 個人の情報を返しうる API かどうか (拒否時の返し方を変える) */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * 公開経路か。**ここに無いものは全て非公開**。
 * 判定は「完全一致 → 前方一致」の順で、接頭辞はセグメント境界で切る
 * (`/login-extra` が `/login` に化けないようにする)。
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.some((route) => route.path === pathname)) return true;
  return PUBLIC_PREFIX.some((route) => {
    const prefix = route.path.endsWith("/") ? route.path : `${route.path}/`;
    return pathname === route.path || pathname.startsWith(prefix);
  });
}

export function evaluateRoute(pathname: string): RouteAccess {
  return isPublicPath(pathname) ? "public" : "session";
}

/**
 * セッションが無い / 無効なときの返し方。
 *  - HTML → /login へリダイレクト
 *  - API  → 401 JSON (リダイレクトすると fetch 側が HTML を掴んで事故る)
 */
export type Denial =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "json"; readonly status: number };

export function denialFor(pathname: string): Denial {
  if (isApiPath(pathname)) return { kind: "json", status: 401 };
  return { kind: "redirect", to: "/login" };
}

/**
 * 公開経路の一覧 (テストと監査用)。
 * 新しい経路を公開したくなったとき、この一覧が増えること自体がレビューの入口になる。
 */
export function publicRouteList(): PublicRoute[] {
  return [...PUBLIC_EXACT, ...PUBLIC_PREFIX];
}
