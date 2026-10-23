import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { fromBase64UrlBytes } from "@/lib/auth/crypto";
import { jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { findUser, touchCredential } from "@/lib/auth/pool";
import { relyingParty } from "@/lib/auth/rp";
import {
  clearChallengeCookie,
  readChallengeCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { recordVisit } from "@/lib/auth/content";

export const dynamic = "force-dynamic";

/** 生体認証の結果を検証してセッションを開始する */
export async function POST(request: Request) {
  const body = await readJson<{ userId?: string; response?: AuthenticationResponseJSON }>(
    request,
  );
  if (!body?.userId || !body.response) return jsonError("リクエストが不正です");

  const pending = await readChallengeCookie();
  if (!pending || pending.mode !== "login" || pending.userId !== body.userId) {
    return jsonError("認証の有効期限が切れました。もういちど おねがいします", 400);
  }

  const user = await findUser(body.userId);
  if (!user) return jsonError("ユーザーが見つかりません", 404);

  const credential = user.credentials.find((c) => c.id === body.response?.id);
  if (!credential) return jsonError("この端末は登録されていません", 404);

  const { rpID, origin } = await relyingParty();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.id,
        publicKey: fromBase64UrlBytes(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
      requireUserVerification: true,
    });
  } catch (error) {
    console.error("[auth] 認証の検証に失敗しました", error);
    return jsonError("じょうずに よみとれませんでした。もういちど やってみてね", 401);
  }

  if (!verification.verified) {
    return jsonError("じょうずに よみとれませんでした。もういちど やってみてね", 401);
  }

  await touchCredential(user.id, credential.id, verification.authenticationInfo.newCounter);
  await setSessionCookie(user.id);
  await clearChallengeCookie();
  const content = await recordVisit(user.id);

  return jsonOk({
    user: {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      color: user.color,
    },
    visits: content.visits,
  });
}
