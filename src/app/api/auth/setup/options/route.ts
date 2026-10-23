import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  CHALLENGE_MAX_AGE_SEC,
  RP_NAME,
  adminPassphrase,
  masterKey,
} from "@/lib/auth/config";
import { encryptSecret, randomId, safeEqual } from "@/lib/auth/crypto";
import { clientKey, jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { findUser, readPool, verifyGuardianPassphrase } from "@/lib/auth/pool";
import { relyingParty } from "@/lib/auth/rp";
import { setChallengeCookie } from "@/lib/auth/session";
import {
  clearFailures,
  isLocked,
  lockMessage,
  recordFailure,
} from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

type SetupMode = "first" | "new" | "device";

type SetupOptionsBody = {
  mode?: SetupMode;
  userId?: string;
  displayName?: string;
  avatar?: string;
  color?: string;
  guardianPassphrase?: string;
  adminPassphrase?: string;
};

/**
 * 端末 (生体認証) の登録 options を作る。
 *
 * - first  : ユーザーが 1 人もいないときの初期セットアップ
 * - new    : 2 人目以降を追加 (管理者パスフレーズが必要)
 * - device : 既存ユーザーに、この端末を追加登録 (そのユーザーの保護者パスフレーズが必要)
 */
export async function POST(request: Request) {
  const body = await readJson<SetupOptionsBody>(request);
  if (!body?.mode || !["first", "new", "device"].includes(body.mode)) {
    return jsonError("mode が不正です");
  }

  const pool = await readPool();
  const ip = await clientKey();
  const { rpID } = await relyingParty();
  const challengeExp = Math.floor(Date.now() / 1000) + CHALLENGE_MAX_AGE_SEC;

  if (body.mode === "first" || body.mode === "new") {
    if (body.mode === "first" && pool.users.length > 0) {
      return jsonError("すでに ユーザーが とうろく されています", 409);
    }

    if (body.mode === "new") {
      const admin = adminPassphrase();
      if (!admin) {
        return jsonError(
          "2人目以降の追加には GUARDIAN_ADMIN_PASSPHRASE の設定が必要です",
          403,
        );
      }
      if (isLocked(`setup:${ip}`)) return jsonError(lockMessage(), 429);
      if (!safeEqual(body.adminPassphrase ?? "", admin)) {
        recordFailure(`setup:${ip}`);
        return jsonError("管理者パスフレーズが ちがいます", 403);
      }
      clearFailures(`setup:${ip}`);
    }

    const displayName = (body.displayName ?? "").trim();
    if (displayName === "") return jsonError("なまえを いれてください");
    if (displayName.length > 24) return jsonError("なまえは 24 もじまでです");
    if (pool.users.some((u) => u.displayName === displayName)) {
      return jsonError(`「${displayName}」は すでに います`, 409);
    }
    const passphrase = (body.guardianPassphrase ?? "").trim();
    if (passphrase.length < 8) {
      return jsonError("保護者パスフレーズは 8 もじいじょうに してください");
    }

    const userId = randomId("u");
    const pendingSecret = encryptSecret(
      JSON.stringify({ guardianPassphrase: passphrase }),
      masterKey(),
    );

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: Buffer.from(userId, "utf8"),
      userName: userId,
      userDisplayName: displayName,
      attestationType: "none",
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    await setChallengeCookie({
      challenge: options.challenge,
      mode: body.mode,
      userId,
      pendingDisplayName: displayName,
      pendingAvatar: body.avatar,
      pendingColor: body.color,
      pendingSecret,
      exp: challengeExp,
    });

    return jsonOk({ options, userId });
  }

  /* mode === "device" */
  if (!body.userId) return jsonError("ユーザーが選ばれていません");
  const user = await findUser(body.userId);
  if (!user) return jsonError("ユーザーが見つかりません", 404);

  const lockKey = `device:${ip}:${user.id}`;
  if (isLocked(lockKey)) return jsonError(lockMessage(), 429);
  if (!verifyGuardianPassphrase(user, body.guardianPassphrase ?? "")) {
    recordFailure(lockKey);
    return jsonError("保護者パスフレーズが ちがいます", 403);
  }
  clearFailures(lockKey);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: Buffer.from(user.id, "utf8"),
    userName: user.id,
    userDisplayName: user.displayName,
    attestationType: "none",
    excludeCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform",
    },
  });

  await setChallengeCookie({
    challenge: options.challenge,
    mode: "device",
    userId: user.id,
    exp: challengeExp,
  });

  return jsonOk({ options, userId: user.id });
}
