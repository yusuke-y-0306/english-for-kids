import { clearChallengeCookie, clearSessionCookie } from "@/lib/auth/session";
import { jsonOk } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/** ログアウト */
export async function POST() {
  await clearSessionCookie();
  await clearChallengeCookie();
  return jsonOk({ loggedOut: true });
}
