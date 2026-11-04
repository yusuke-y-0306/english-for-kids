import { cookies, headers } from "next/headers";
import { clearChallengeCookie, clearSessionCookie } from "@/lib/auth/session";
import { revokeDeviceSessions } from "@/lib/auth/pool";
import { bindingOf } from "@/lib/auth/ua";
import { checkRequestSession } from "@/lib/auth/verify";
import { jsonOk } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/**
 * ログアウト — issue #62
 *
 * cookie を消すだけでは **サーバ側のセッションは生きたまま** になる。署名 cookie は
 * ステートレスなので実体が無く、コピーされた cookie は `exp` まで通ってしまう。
 * そこで「この端末の世代」を上げて (#52 の仕組み)、cookie を消す前に **サーバ側で殺す**。
 *
 * 端末単位 (`revokeDeviceSessions`) にするのが要点。全端末 (`revokeAllSessions`) に
 * すると、同じ子が使っている別の端末まで巻き添えでログアウトになる。
 *
 * セッションが無い / 期限切れ / 端末が変わっている / 既に失効済みのときは何もしない。
 * `logout` は cookie の掃除として **常に成功** させる (401 を返すと、死んだ cookie を
 * 掴んだブラウザがログイン画面へ行けなくなる)。
 */
export async function POST() {
  try {
    const store = await cookies();
    const h = await headers();
    const check = await checkRequestSession((name) => store.get(name)?.value, {
      ua: h.get("user-agent"),
    });

    if (check.ok) {
      /* 失効させるのは **cookie に載っている指紋**。UA が変わっていても (drift)、
         いま捨てようとしている資格情報はそちらなので、現在の指紋を上げても死なない。
         `ua` を持たない古い cookie (legacy) だけは現在の指紋で代用する。 */
      const ua = check.session.ua && check.session.ua !== ""
        ? check.session.ua
        : bindingOf(h.get("user-agent")).ua;
      await revokeDeviceSessions(check.session.uid, ua);
    }
  } catch (error) {
    /* 失効に失敗しても cookie は消す。次のログインで新しい世代が振られる */
    console.warn("[auth] ログアウト時のセッション失効に失敗しました", error);
  }

  await clearSessionCookie();
  await clearChallengeCookie();
  return jsonOk({ loggedOut: true });
}
