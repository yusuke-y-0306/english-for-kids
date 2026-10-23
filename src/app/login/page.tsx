import { redirect } from "next/navigation";
import { adminPassphrase } from "@/lib/auth/config";
import { listUsersForPicker, readPool } from "@/lib/auth/pool";
import { getCurrentUser } from "@/lib/auth/session";
import LoginPanel from "./LoginPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ログイン | こども英語ひろば",
};

/** ログイン画面 — アバターを えらんで、ゆび/かお で ログイン */
export default async function LoginPage() {
  const current = await getCurrentUser();
  if (current) redirect("/");

  const [users, pool] = await Promise.all([listUsersForPicker(), readPool()]);

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <div className="text-center">
        <h1 className="text-[1.8rem] leading-tight font-extrabold tracking-tight text-ink sm:text-[2.2rem]">
          こども英語<span className="text-forest">ひろば</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
          じぶんの なまえを おしてね。
          <br />
          ゆび か かお で ログイン できるよ。
        </p>
      </div>

      <LoginPanel
        users={users}
        needsSetup={pool.users.length === 0}
        adminEnabled={Boolean(adminPassphrase())}
      />
    </main>
  );
}
