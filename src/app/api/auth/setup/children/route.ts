import { clientKey, jsonError, jsonOk, readJson } from "@/lib/auth/http";
import { listUsersForPicker } from "@/lib/auth/pool";
import { guardianAccess } from "@/lib/auth/guard";
import {
  clearFailures,
  isLocked,
  lockMessage,
  recordFailure,
} from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

/**
 * この端末で えらべる こどもの 一覧を返す。
 *
 * 「新しい端末で URL を開いただけで 家族の なまえが 見える」のを避けるため、
 * 一覧は **おうちの 合言葉を 確かめた あと** にだけ返す。
 * 端末の とうろく (mode=device) の前段として使う。
 */
export async function POST(request: Request) {
  const body = await readJson<{ guardianPassphrase?: string }>(request);

  const ip = await clientKey();
  const lockKey = `children:${ip}`;
  if (isLocked(lockKey)) return jsonError(lockMessage(), 429);

  const access = await guardianAccess(body?.guardianPassphrase ?? "");
  if (!access) {
    recordFailure(lockKey);
    return jsonError("合言葉（保護者パスフレーズ）が ちがいます", 403);
  }
  clearFailures(lockKey);

  return jsonOk({ users: await listUsersForPicker(access) });
}
