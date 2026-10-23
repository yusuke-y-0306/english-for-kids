import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { CHALLENGE_MAX_AGE_SEC } from "@/lib/auth/config";
import { jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { findUser } from "@/lib/auth/pool";
import { relyingParty } from "@/lib/auth/rp";
import { setChallengeCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * 生体認証 (ログイン) の options を作る。
 * 子どもは ID / パスワードを打てないので、ここは「アバターを選ぶだけ」で到達できる。
 */
export async function POST(request: Request) {
  const body = await readJson<{ userId?: string }>(request);
  if (!body?.userId) return jsonError("ユーザーが選ばれていません");

  const user = await findUser(body.userId);
  if (!user) return jsonError("ユーザーが見つかりません", 404);
  if (user.credentials.length === 0) {
    return jsonError("この ユーザーは まだ 端末が とうろく されていません", 409);
  }

  const { rpID } = await relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: user.credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    userVerification: "required",
  });

  await setChallengeCookie({
    challenge: options.challenge,
    mode: "login",
    userId: user.id,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_MAX_AGE_SEC,
  });

  return jsonOk({ options });
}
