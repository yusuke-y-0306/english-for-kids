import { listUsersForPicker } from "@/lib/auth/pool";
import { jsonOk } from "@/lib/auth/http";
import { readPool } from "@/lib/auth/pool";

export const dynamic = "force-dynamic";

/** ログイン画面に出すユーザー一覧 (秘密・公開鍵は返さない) */
export async function GET() {
  const [users, pool] = await Promise.all([listUsersForPicker(), readPool()]);
  return jsonOk({ users, needsSetup: pool.users.length === 0 });
}
