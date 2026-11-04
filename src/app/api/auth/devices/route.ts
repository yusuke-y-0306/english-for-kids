import { clientKey, jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { findUser, listDevices, verifyFamilyPassphrase } from "@/lib/auth/pool";
import { clearFailures, isLocked, lockMessage, recordFailure } from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

/**
 * その子がログインしたことのある端末の一覧 — issue #52
 *
 * 「端末を失くした」ときに、親が **どの端末を切るか** を選ぶためのもの。
 * おうちの 合言葉を確かめてから、その子の端末だけを返す。
 *
 * 端末の識別子は `User-Agent` のハッシュ (16 文字) なので、生の UA は出さない。
 */
export async function POST(request: Request) {
  const body = await readJson<{ userId?: string; guardianPassphrase?: string }>(request);

  const ip = await clientKey();
  const lockKey = `devices:${ip}`;
  if (isLocked(lockKey)) return jsonError(lockMessage(), 429);

  if (!(await verifyFamilyPassphrase(body?.guardianPassphrase ?? ""))) {
    recordFailure(lockKey);
    return jsonError("合言葉（保護者パスフレーズ）が ちがいます", 403);
  }
  clearFailures(lockKey);

  const userId = (body?.userId ?? "").trim();
  if (userId === "") return jsonError("userId が 必要です");
  if (!(await findUser(userId))) return jsonError("ユーザーが見つかりません", 404);

  const devices = (await listDevices(userId)) ?? [];
  return jsonOk({
    devices: devices.map((device) => ({
      ua: device.ua,
      uc: device.uc,
      lastSeenAt: device.lastSeenAt,
    })),
  });
}
