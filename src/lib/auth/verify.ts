import { SESSION_COOKIE, sessionSecret } from "./config";
import { verifyToken } from "./crypto";
import { findUser, type PoolUser } from "./pool";

/**
 * セッション cookie の検証 — **`next/headers` に依存しない**版。
 *
 * `session.ts` の `readSession()` は Server Component / Route Handler 用で、
 * 内部で `cookies()` を呼ぶ。proxy (リクエストの入口) ではそれが使えないので、
 * 検証の本体をここに切り出して両方から使う。
 *
 * 検証する内容:
 *  1. 署名 (HMAC-SHA256) — 改ざんされていないか
 *  2. 期限 (exp) — 切れていないか
 *  3. ユーザーの存在 — pool から消えた ID を掴んでいないか
 */

export type SessionPayload = {
  uid: string;
  iat: number;
  exp: number;
};

export type SessionFailure =
  | "missing"
  | "no-secret"
  | "bad-signature"
  | "expired"
  | "no-user";

export type SessionCheck =
  | { readonly ok: true; readonly session: SessionPayload; readonly user: PoolUser }
  | { readonly ok: false; readonly reason: SessionFailure };

/** 署名と期限だけ見る (ユーザーの存在は見ない / 同期) */
export function verifySessionPayload(
  token: string | undefined | null,
): { ok: true; session: SessionPayload } | { ok: false; reason: SessionFailure } {
  if (!token) return { ok: false, reason: "missing" };

  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    // 鍵が無い = 検証できない。通さない (fail closed)
    return { ok: false, reason: "no-secret" };
  }

  const payload = verifyToken<SessionPayload>(token, secret);
  if (!payload || typeof payload.uid !== "string") {
    return { ok: false, reason: "bad-signature" };
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, session: payload };
}

/** 署名 + 期限 + ユーザー存在まで見る */
export async function checkSessionToken(
  token: string | undefined | null,
): Promise<SessionCheck> {
  const base = verifySessionPayload(token);
  if (!base.ok) return base;
  const user = await findUser(base.session.uid);
  if (!user) return { ok: false, reason: "no-user" };
  return { ok: true, session: base.session, user };
}

/** リクエストの cookie からセッションを検証する (proxy 用) */
export function checkRequestSession(
  getCookie: (name: string) => string | undefined,
): Promise<SessionCheck> {
  return checkSessionToken(getCookie(SESSION_COOKIE));
}
