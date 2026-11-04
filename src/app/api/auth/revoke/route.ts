import { headers } from "next/headers";
import { clientKey, jsonError, jsonOk, readJson } from "@/lib/auth/http";
import {
  findUser,
  revokeAllSessions,
  revokeDeviceSessions,
  verifyFamilyPassphrase,
} from "@/lib/auth/pool";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth/session";
import { bindingOf } from "@/lib/auth/ua";
import { clearFailures, isLocked, lockMessage, recordFailure } from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

/**
 * セッションの即時失効 — issue #52
 *
 * 2 通りの呼び方がある:
 *
 *  1. **本人のセッションで呼ぶ** (合言葉なし)
 *     → 自分のセッションを切る。`scope: "all"` は全端末、`"device"` はこの端末だけ。
 *  2. **おうちの 合言葉で呼ぶ** (端末を失くした子を親が切る)
 *     → `userId` を指定して、その子の全端末 / 特定端末を切る。
 *
 * `efk_device` (この端末が覚えている こども) は **消さない**。セッションだけ切って、
 * 次にログインするときの候補は残す方が子どもに優しい。
 */

type RevokeBody = {
  scope?: "all" | "device";
  /** 合言葉で呼ぶときに切る対象 */
  userId?: string;
  /** `scope: "device"` のときの端末 (UA ハッシュ) */
  ua?: string;
  guardianPassphrase?: string;
};

export async function POST(request: Request) {
  const body = await readJson<RevokeBody>(request);
  const scope = body?.scope === "device" ? "device" : "all";
  const passphrase = body?.guardianPassphrase ?? "";

  /* ---------- 1. おうちの ひと (合言葉で対象を指定) ---------- */

  if (passphrase !== "") {
    const ip = await clientKey();
    const lockKey = `revoke:${ip}`;
    if (isLocked(lockKey)) return jsonError(lockMessage(), 429);

    if (!(await verifyFamilyPassphrase(passphrase))) {
      recordFailure(lockKey);
      return jsonError("合言葉（保護者パスフレーズ）が ちがいます", 403);
    }
    clearFailures(lockKey);

    const userId = (body?.userId ?? "").trim();
    if (userId === "") return jsonError("userId が 必要です");
    if (!(await findUser(userId))) return jsonError("ユーザーが見つかりません", 404);

    if (scope === "device") {
      const ua = (body?.ua ?? "").trim();
      if (ua === "") return jsonError("ua が 必要です");
      const deviceVersion = await revokeDeviceSessions(userId, ua);
      if (deviceVersion === undefined) return jsonError("その端末は 見つかりません", 404);
      return jsonOk({ scope, userId, deviceVersion });
    }

    const tokenVersion = await revokeAllSessions(userId);
    return jsonOk({ scope: "all", userId, tokenVersion });
  }

  /* ---------- 2. 本人のセッション ---------- */

  const current = await getCurrentUser();
  if (!current) return jsonError("ログインが必要です", 401);

  if (scope === "device") {
    const ua = bindingOf((await headers()).get("user-agent")).ua;
    const deviceVersion = await revokeDeviceSessions(current.id, ua);
    /* この端末の cookie も消す (自分の首を切るので、消さないと次で弾かれる) */
    await clearSessionCookie();
    return jsonOk({ scope, deviceVersion: deviceVersion ?? 0 });
  }

  const tokenVersion = await revokeAllSessions(current.id);
  await clearSessionCookie();
  return jsonOk({ scope: "all", tokenVersion: tokenVersion ?? 0 });
}
