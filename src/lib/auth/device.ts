import { cookies, headers } from "next/headers";
import { sessionSecret } from "./config";
import { signToken, verifyToken } from "./crypto";

/**
 * 「この端末で つかったことがある こども」を覚えておく cookie。
 *
 * ログイン画面は こどもの なまえ と アバターを 並べるので、URL を知っている
 * だけの 新しい端末に 家族の なまえが 見えてしまう。そこで
 *
 *   - パスキーを とうろく / ログインした端末 → その こどもを 覚える
 *   - 覚えの無い端末 → なまえを 出さず「はじめての たんまつ」として扱う
 *
 * の 2 段階にする。端末の識別は 署名付き cookie だけで行い、サーバーには
 * 何も溜めない (DB を持たない方針はそのまま)。
 */
export const DEVICE_COOKIE = "efk_device";

/** 1 年。子どもが毎回 親を呼ばなくて済むように長めに取る */
const DEVICE_MAX_AGE_SEC = 60 * 60 * 24 * 365;
const MAX_USERS = 12;

type DevicePayload = {
  uids: string[];
  exp: number;
};

async function isSecureRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const host = h.get("host") ?? "";
  return !(
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.startsWith("[::1]")
  );
}

/** この端末で つかったことがある ユーザー ID (無ければ空) */
export async function readDeviceUsers(): Promise<string[]> {
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return [];
  }
  const store = await cookies();
  const payload = verifyToken<DevicePayload>(store.get(DEVICE_COOKIE)?.value, secret);
  if (!payload || !Array.isArray(payload.uids)) return [];
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return [];
  return payload.uids.filter((uid): uid is string => typeof uid === "string");
}

/** この端末を「つかったことがある」状態にする */
export async function rememberDeviceUser(userId: string): Promise<void> {
  const existing = await readDeviceUsers();
  const uids = [userId, ...existing.filter((uid) => uid !== userId)].slice(0, MAX_USERS);
  const payload: DevicePayload = {
    uids,
    exp: Math.floor(Date.now() / 1000) + DEVICE_MAX_AGE_SEC,
  };
  const store = await cookies();
  store.set(DEVICE_COOKIE, signToken(payload, sessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: DEVICE_MAX_AGE_SEC,
  });
}
