import { generateRegistrationOptions } from "@simplewebauthn/server";
import { CHALLENGE_MAX_AGE_SEC, RP_NAME, masterKey } from "@/lib/auth/config";
import { encryptSecret, randomId } from "@/lib/auth/crypto";
import { clientKey, jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { normalizePassphrase } from "@/lib/auth/passphrase";
import { readPool, verifyFamilyPassphrase } from "@/lib/auth/pool";
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
  /** おうち 共通の合言葉 (保護者パスフレーズ)。新規追加でも端末追加でも同じ */
  guardianPassphrase?: string;
};

/**
 * 端末 (生体認証) の登録 options を作る。
 *
 * - first  : ユーザーが 1 人もいないときの初期セットアップ。合言葉をここで決める
 * - new    : 2 人目以降を追加。おうち 共通の合言葉が必要
 * - device : 既存の こどもに、この端末を追加登録。同じ 合言葉が必要
 *
 * 秘密は「おうち 共通の合言葉」1 つだけ。以前は 追加用の管理者パスフレーズと
 * 端末追加用の保護者パスフレーズの 2 つがあり、どちらも親が覚える必要があった。
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

  if (body.mode === "first") {
    if (pool.users.length > 0) {
      return jsonError("すでに ユーザーが とうろく されています", 409);
    }
  }

  if (body.mode === "first" || body.mode === "new") {
    const displayName = (body.displayName ?? "").trim();
    if (displayName === "") return jsonError("なまえを いれてください");
    if (displayName.length > 24) return jsonError("なまえは 24 もじまでです");
    if (pool.users.some((u) => u.displayName === displayName)) {
      return jsonError(`「${displayName}」は すでに います`, 409);
    }

    /* 追加 (2 人目以降) だけ合言葉を要求する。最初の 1 人は ここで決める。 */
    let pendingSecret;
    if (body.mode === "new") {
      if (isLocked(`setup:${ip}`)) return jsonError(lockMessage(), 429);
      if (!(await verifyFamilyPassphrase(body.guardianPassphrase ?? ""))) {
        recordFailure(`setup:${ip}`);
        return jsonError(
          "合言葉（保護者パスフレーズ）が ちがいます。わすれた ときは おうちの ひとに そうだんしてね",
          403,
        );
      }
      clearFailures(`setup:${ip}`);
      /* 新しい こどもも 同じ 合言葉で 端末を 追加できるようにする */
      pendingSecret = pool.familySecret ?? pool.users.find((u) => u.secret)?.secret;
      if (!pendingSecret) {
        return jsonError("合言葉が まだ とうろく されていません", 409);
      }
    } else {
      const passphrase = normalizePassphrase(body.guardianPassphrase ?? "");
      if (passphrase.length < 8) {
        return jsonError("合言葉は 8 もじ いじょうに してください");
      }
      pendingSecret = encryptSecret(
        JSON.stringify({ guardianPassphrase: passphrase }),
        masterKey(),
      );
    }

    const userId = randomId("u");

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
  const user = pool.users.find((u) => u.id === body.userId);
  if (!user) return jsonError("ユーザーが見つかりません", 404);

  const lockKey = `device:${ip}:${user.id}`;
  if (isLocked(lockKey)) return jsonError(lockMessage(), 429);
  if (!(await verifyFamilyPassphrase(body.guardianPassphrase ?? ""))) {
    recordFailure(lockKey);
    return jsonError("合言葉（保護者パスフレーズ）が ちがいます", 403);
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
