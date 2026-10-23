import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { toBase64Url } from "@/lib/auth/crypto";
import { jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { addCredential, createUser, findUser, readPool } from "@/lib/auth/pool";
import { relyingParty } from "@/lib/auth/rp";
import {
  clearChallengeCookie,
  readChallengeCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { recordVisit } from "@/lib/auth/content";

export const dynamic = "force-dynamic";

/** 端末登録 (生体認証) の結果を検証し、ユーザー/端末を保存してログイン状態にする */
export async function POST(request: Request) {
  const body = await readJson<{ response?: RegistrationResponseJSON }>(request);
  if (!body?.response) return jsonError("リクエストが不正です");

  const pending = await readChallengeCookie();
  if (!pending) {
    return jsonError("登録の有効期限が切れました。もういちど おねがいします", 400);
  }

  const { rpID, origin } = await relyingParty();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    console.error("[auth] 登録の検証に失敗しました", error);
    return jsonError("とうろくに しっぱい しました。もういちど やってみてね", 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return jsonError("とうろくに しっぱい しました。もういちど やってみてね", 400);
  }

  const { credential } = verification.registrationInfo;
  const stored = {
    id: credential.id,
    publicKey: toBase64Url(Buffer.from(credential.publicKey)),
    counter: credential.counter,
    transports: credential.transports,
    createdAt: new Date().toISOString(),
  };

  try {
    if (pending.mode === "first" || pending.mode === "new") {
      const pool = await readPool();
      if (pending.mode === "first" && pool.users.length > 0) {
        return jsonError("すでに ユーザーが とうろく されています", 409);
      }
      if (!pending.pendingDisplayName || !pending.pendingSecret) {
        return jsonError("登録情報が ふそく しています", 400);
      }
      await createUser({
        id: pending.userId,
        displayName: pending.pendingDisplayName,
        avatar: pending.pendingAvatar,
        color: pending.pendingColor,
        preparedSecret: pending.pendingSecret,
      });
      await addCredential(pending.userId, stored);
    } else {
      const user = await findUser(pending.userId);
      if (!user) return jsonError("ユーザーが見つかりません", 404);
      await addCredential(user.id, stored);
    }
  } catch (error) {
    console.error("[auth] 端末の保存に失敗しました", error);
    return jsonError("とうろくの ほぞんに しっぱい しました", 500);
  }

  await setSessionCookie(pending.userId);
  await clearChallengeCookie();
  await recordVisit(pending.userId);

  const user = await findUser(pending.userId);
  return jsonOk({
    user: user
      ? {
          id: user.id,
          displayName: user.displayName,
          avatar: user.avatar,
          color: user.color,
        }
      : null,
  });
}
