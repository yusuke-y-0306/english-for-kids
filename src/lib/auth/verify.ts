import { SESSION_COOKIE, sessionSecret, sessionUaStrict } from "./config";
import { verifyToken } from "./crypto";
import { findUser, type PoolUser } from "./pool";
import type { SessionPayload } from "./token";
import { bindingOf, compareBinding } from "./ua";

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
 *  4. 端末 — `User-Agent` の指紋が cookie を発行した端末と同じか (issue #53)
 */

export type { SessionPayload } from "./token";

export type SessionFailure =
  | "missing"
  | "no-secret"
  | "bad-signature"
  | "expired"
  | "no-user"
  | "ua-mismatch";

/**
 * `rebind` は「通すが、いまの端末の指紋で cookie を再発行したい」の意。
 *  - legacy: `ua` を持たない古い cookie (移行措置)
 *  - drift : 同じ種類だがハッシュが違う (ブラウザ更新)
 */
export type SessionCheck =
  | {
      readonly ok: true;
      readonly session: SessionPayload;
      readonly user: PoolUser;
      readonly rebind?: "legacy" | "drift";
    }
  | { readonly ok: false; readonly reason: SessionFailure };

/** 端末の同一性を見るための材料 (proxy / Server Component の両方から渡す) */
export type SessionContext = {
  ua?: string | null;
  /** 省略時は環境変数 `SESSION_UA_STRICT` に従う */
  strict?: boolean;
};

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

/** 署名 + 期限 + ユーザー存在 + 端末 まで見る */
export async function checkSessionToken(
  token: string | undefined | null,
  context: SessionContext = {},
): Promise<SessionCheck> {
  const base = verifySessionPayload(token);
  if (!base.ok) return base;

  const verdict = compareBinding(
    base.session,
    bindingOf(context.ua),
    context.strict ?? sessionUaStrict(),
  );
  // 端末が変わっている = コピーされた cookie かもしれないので通さない
  if (verdict === "mismatch") return { ok: false, reason: "ua-mismatch" };

  const user = await findUser(base.session.uid);
  if (!user) return { ok: false, reason: "no-user" };

  return verdict === "ok"
    ? { ok: true, session: base.session, user }
    : { ok: true, session: base.session, user, rebind: verdict };
}

/** リクエストの cookie からセッションを検証する (proxy 用) */
export function checkRequestSession(
  getCookie: (name: string) => string | undefined,
  context: SessionContext = {},
): Promise<SessionCheck> {
  return checkSessionToken(getCookie(SESSION_COOKIE), context);
}
