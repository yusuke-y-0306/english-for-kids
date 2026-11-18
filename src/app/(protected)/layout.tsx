import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * ログイン必須エリア。
 * セッションが無ければ /login へ。cookie は署名付きなので、
 * ここを通る = 生体認証を通過したユーザー、という保証になる。
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  /*
   * 端末内推論の事前読み込み (WasmWarmup) は **発音練習のページだけ** に置いている。
   * エンジンは `'unsafe-eval'` を必要とし、それを許可しているのは `/pronunciation`
   * だけだから (issue #2 / `lib/security/csp.ts`)。
   * ここに置くと、他のページでも 51MB を読み込んで EvalError で失敗する。
   */
  return <>{children}</>;
}
