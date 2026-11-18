import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import WasmWarmup from "@/components/speech/WasmWarmup";

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
  return (
    <>
      {/* 発音練習を開いた瞬間に 40 秒待たせないよう、裏でモデルを読み込んでおく (issue #2) */}
      <WasmWarmup />
      {children}
    </>
  );
}
