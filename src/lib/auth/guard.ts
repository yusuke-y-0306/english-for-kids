import { readDeviceUsers } from "./device";
import { getCurrentUser } from "./session";
import { verifyFamilyPassphrase, type PoolUser } from "./pool";
import type { PersonalDataAccess } from "./access";

/**
 * 認可済みであることを示す許可証の発行所。
 *
 * 許可証 (`PersonalDataAccess`) を作れるのはこのファイルだけ。個人情報を返す
 * 関数は許可証を引数に要求するので、**認可を通さずに呼ぶコードはコンパイルが通らない**。
 *
 * 一次防御は proxy.ts の default-deny。ここは「proxy をすり抜けた / 将来
 * matcher を緩めた」ときの二重目の壁として置いている。
 */

function seal(
  scope: PersonalDataAccess["scope"],
  visibleUserIds: PersonalDataAccess["visibleUserIds"],
): PersonalDataAccess {
  // access.ts の unique symbol は外から作れないので、実体を作れるのはここだけ
  return { scope, visibleUserIds } as unknown as PersonalDataAccess;
}

/**
 * セッション本人として。ログインしていなければ null。
 * 見えるのは自分だけ。
 */
export async function currentUserAccess(): Promise<PersonalDataAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return seal("self", [user.id]);
}

/**
 * この端末で使ったことがある子どもとして (端末 cookie)。
 * 新しい端末では空 = 何も見えない。
 */
export async function deviceAccess(): Promise<PersonalDataAccess> {
  return seal("device", await readDeviceUsers());
}

/**
 * おうちの合言葉を確認済みとして。家族全員が見える。
 * 合言葉が違えば null。
 */
export async function guardianAccess(passphrase: string): Promise<PersonalDataAccess | null> {
  if (!(await verifyFamilyPassphrase(passphrase))) return null;
  return seal("guardian", "all");
}

/** 認可が無いときに投げる。Route Handler は捕捉して 401 を返す */
export class UnauthorizedError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "UnauthorizedError";
  }
}

/**
 * Route Handler 用の二重チェック。proxy が一次防御だが、proxy の matcher を
 * 将来いじったときに無防備にならないよう、個人情報を返すハンドラはここを通す。
 *
 * 戻り値は `PersonalDataAccess` 付きなので、以降のデータ取得も型で繋がる。
 */
export async function requireSessionUser(): Promise<{
  user: PoolUser;
  access: PersonalDataAccess;
}> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return { user, access: seal("self", [user.id]) };
}
