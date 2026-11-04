import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_MAX_AGE_SEC,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  sessionSecret,
  sessionUaStrict,
} from "./config";
import { signToken, verifyToken, type EncryptedSecret } from "./crypto";
import { findUser, type PoolUser } from "./pool";
import { issueSessionToken, type SessionPayload } from "./token";
import { bindingOf, compareBinding } from "./ua";

/**
 * セッション管理。
 * DB を使わないので、署名付き (HMAC-SHA256) の cookie にユーザー ID を入れて運ぶ。
 */

export type { SessionPayload } from "./token";
export { issueSessionToken } from "./token";

async function isSecureRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const host = h.get("host") ?? "";
  return !(host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]"));
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  /* 発行した端末を覚えておく。以後のリクエストで UA が変わっていたら弾く/再発行する */
  const binding = bindingOf((await headers()).get("user-agent"));
  store.set(SESSION_COOKIE, issueSessionToken(userId, binding), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: 0,
  });
}

/** cookie からセッションを取り出す (署名検証 + 期限チェック + 端末チェック) */
export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return null;
  }
  const payload = verifyToken<SessionPayload>(token, secret);
  if (!payload || typeof payload.uid !== "string") return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;

  /* 端末が変わっていたら「ログインしていない」扱い。
     legacy / drift はそのまま通す (cookie の再発行は proxy が行う)。 */
  const verdict = compareBinding(payload, bindingOf((await headers()).get("user-agent")), sessionUaStrict());
  if (verdict === "mismatch") return null;

  return payload;
}

/**
 * 現在ログイン中のユーザー。1 リクエスト内ではキャッシュされる。
 * セッションはあるがユーザーが消えている場合は null。
 */
export const getCurrentUser = cache(async (): Promise<PoolUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await findUser(session.uid);
  return user ?? null;
});

/* ------------------------------------------------------------------ */
/* WebAuthn チャレンジの一時保管 (cookie / 5分)                        */
/* ------------------------------------------------------------------ */

export type ChallengePayload = {
  challenge: string;
  mode: "login" | "first" | "new" | "device";
  userId: string;
  /** 新規作成 (first/new) のときに使う、まだ保存していないプロフィール */
  pendingDisplayName?: string;
  pendingAvatar?: string;
  pendingColor?: string;
  /** 新規作成時に保存する「秘密」(マスター鍵で暗号化済み) */
  pendingSecret?: EncryptedSecret;
  exp: number;
};

export const CHALLENGE_PENDING_COOKIE = CHALLENGE_COOKIE;

export async function setChallengeCookie(payload: ChallengePayload): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, signToken(payload, sessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: CHALLENGE_MAX_AGE_SEC,
  });
}

export async function readChallengeCookie(): Promise<ChallengePayload | null> {
  const store = await cookies();
  const payload = verifyToken<ChallengePayload>(
    store.get(CHALLENGE_COOKIE)?.value,
    sessionSecret(),
  );
  if (!payload) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export async function clearChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: 0,
  });
}
