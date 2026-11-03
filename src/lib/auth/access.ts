/**
 * 個人情報を読むための「許可証」— 型で強制するための土台
 *
 * ここには **型だけ** を置く (他のモジュールを import しない)。
 * 許可証を作れるのは `guard.ts` だけ、という関係を循環 import なしで作るため。
 *
 * 使い方:
 *
 *   const access = await requireDeviceAccess();     // 端末 cookie で認可
 *   const users = await listUsersForPicker(access); // 許可証が無いとコンパイルが通らない
 *
 * これで「うっかり個人情報を返す関数を呼ぶ」がレビューではなくビルドで止まる。
 * ただしこれは二重目の防御で、一次防御は proxy.ts の default-deny (gate.ts)。
 */

// このファイルの外では作れない鍵。オブジェクトリテラルで偽造できない。
declare const authorizedScope: unique symbol;

export type AccessScope =
  /** セッション本人。自分の情報だけ */
  | "self"
  /** この端末で使ったことがある子ども (端末 cookie)。その端末の履歴だけ */
  | "device"
  /** おうちの合言葉を確認済み。家族全員 */
  | "guardian";

export type PersonalDataAccess = {
  readonly [authorizedScope]: AccessScope;
  readonly scope: AccessScope;
  /** 見てよいユーザー ID。"all" は合言葉を確認した場合だけ */
  readonly visibleUserIds: readonly string[] | "all";
};

/** 一覧を許可証の範囲に絞る。範囲外は黙って落とす (fail closed) */
export function filterVisible<T extends { id: string }>(
  items: readonly T[],
  access: PersonalDataAccess,
): T[] {
  if (access.visibleUserIds === "all") return [...items];
  const allowed = new Set(access.visibleUserIds);
  return items.filter((item) => allowed.has(item.id));
}

/** 個別のユーザーを見てよいか */
export function canSee(access: PersonalDataAccess, userId: string): boolean {
  return access.visibleUserIds === "all" || access.visibleUserIds.includes(userId);
}
