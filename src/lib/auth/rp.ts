import { headers } from "next/headers";
import { originFromEnv, rpIDFromEnv } from "./config";

/**
 * WebAuthn の RP ID / オリジンを決める。
 *
 * 本番は環境変数で固定する (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN)。
 * 未設定のときはリクエストのホストから推測する — 開発や一時トンネル用。
 * 注意: RP ID が変わると、以前に登録した生体認証は使えなくなる。
 */
export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const envRpID = rpIDFromEnv();
  const envOrigin = originFromEnv();
  if (envRpID && envOrigin) return { rpID: envRpID, origin: envOrigin };

  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || h.get("host") || "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal =
    host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]");
  const proto = forwardedProto || (isLocal ? "http" : "https");
  const hostname = host.replace(/:\d+$/, "");

  return {
    rpID: envRpID ?? hostname,
    origin: envOrigin ?? `${proto}://${host}`,
  };
}
