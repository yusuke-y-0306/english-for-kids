import { listUsersForPicker, readPool } from "@/lib/auth/pool";
import { deviceAccess } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/session";
import LoginPanel from "./LoginPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ログイン | こども英語ひろば",
};

/**
 * ログイン画面 — アバターを えらんで、ゆび/かお で ログイン
 *
 * ログイン中でも この画面を 開けるようにしている (リダイレクトしない)。
 * 家族で 1 台を 共有していると「いま だれで ログインしているか」を
 * 切りかえたいし、こどもを 追加する 入口も ここにしかないため。
 */
export default async function LoginPage({
  searchParams,
}: {
  /** proxy が付ける `?reason=ua_changed` (端末の指紋が変わった) を拾う — issue #53 */
  searchParams: Promise<{ reason?: string }>;
}) {
  const reason = (await searchParams)?.reason;
  const current = await getCurrentUser();

  /* この端末で つかったことのある こどもだけを出す。
     URL を知っているだけの 新しい端末に 家族の なまえを 見せない。
     絞り込みは呼び出し側ではなく `deviceAccess()` の許可証が持っている
     (listUsersForPicker は許可証の範囲外を返さない)。 */
  const [users, pool] = await Promise.all([
    listUsersForPicker(await deviceAccess()),
    readPool(),
  ]);
  const firstTimeDevice = pool.users.length > 0 && users.length === 0;

  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <div className="text-center">
        <h1 className="text-[1.8rem] leading-tight font-extrabold tracking-tight text-ink sm:text-[2.2rem]">
          こども英語<span className="text-forest">ひろば</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed font-bold text-[#5b4a3c]">
          {firstTimeDevice ? (
            <>
              この たんまつは はじめて ですね。
              <br />
              おうちの ひとと いっしょに はじめよう。
            </>
          ) : (
            <>
              じぶんの なまえを おしてね。
              <br />
              ゆび か かお で ログイン できるよ。
            </>
          )}
        </p>
      </div>

      <LoginPanel
        users={users}
        needsSetup={pool.users.length === 0}
        firstTimeDevice={firstTimeDevice}
        deviceChanged={reason === "ua_changed"}
        currentUser={
          current
            ? {
                id: current.id,
                displayName: current.displayName,
                avatar: current.avatar,
                color: current.color,
              }
            : null
        }
      />
    </main>
  );
}
