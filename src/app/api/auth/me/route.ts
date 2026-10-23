import { jsonOk } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** いまログインしているユーザー */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonOk({ user: null });
  return jsonOk({
    user: {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      color: user.color,
    },
  });
}
