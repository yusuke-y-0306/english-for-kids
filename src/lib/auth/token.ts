import { SESSION_MAX_AGE_SEC, sessionSecret } from "./config";
import { signToken } from "./crypto";
import type { DeviceBinding } from "./ua";

/**
 * セッション cookie の中身と発行。
 *
 * `session.ts` から切り出してある理由: proxy (リクエストの入口) は
 * `next/headers` の `cookies()` を呼べないが、UA の変化に応じて cookie を
 * 発行し直す必要がある (issue #53)。署名の材料だけをここに集めて、
 * 「cookie を読む/書く」層 (session.ts / proxy.ts) から共通で使う。
 */

export type SessionPayload = {
  uid: string;
  iat: number;
  exp: number;
  /** 発行時の `User-Agent` のハッシュ (先頭 16 文字)。issue #53 */
  ua?: string;
  /** 発行時の端末の種類 (iphone / ipad / android / mac / windows / linux / other) */
  uc?: string;
};

export function issueSessionToken(userId: string, binding?: DeviceBinding): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: userId,
    iat: now,
    exp: now + SESSION_MAX_AGE_SEC,
    ...(binding ?? {}),
  };
  return signToken(payload, sessionSecret());
}
