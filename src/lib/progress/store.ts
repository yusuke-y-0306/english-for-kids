import { getUserContent, updateUserContent } from "@/lib/auth/content";
import { withUserLock } from "@/lib/store/lock";
import {
  applyCardView,
  applyQuizRound,
  normalizeProgressState,
  type CardViewInput,
  type ProgressState,
  type QuizRoundInput,
} from "./state";

/**
 * 学習履歴の保存 — issue #4 (進捗管理)
 *
 * 保存先は既存の **ユーザー単位 JSON** (`data/content/<uid>.json`) の
 * `data.progress`。DB は使わない方針 (#32 の発音ストアと同じ場所・同じ流儀)。
 *
 * この層の責任は「読み書きと直列化」だけ。数字の作り方は `state.ts` (純粋関数) にある。
 * `userId` は **呼び出し側 (Route Handler) がセッションから取った値** を渡すこと。
 * リクエストボディの値をそのまま通すと他人の学習履歴を書き換えられる (#32 の IDOR 対策)。
 *
 * 発音 (#66) の日次だけは **このモジュールを通さない**。発音は「発音ストア +
 * 進捗の日次」を同じファイルに書くので、`recordPronunciationAttempt()` が
 * 同じロックの中で 1 回の書き込みにまとめている (2 回書くと部分更新の窓ができる)。
 */

export type { ProgressState } from "./state";

/** read-modify-write の結果。「書いたかどうか」も返す (無変更ならファイルに触らない) */
type MutationResult = { state: ProgressState; changed: boolean };

/** 現在の状態を読む (無ければ空。壊れていても空に正規化される) */
export async function getProgressState(userId: string): Promise<ProgressState> {
  const content = await getUserContent(userId);
  return normalizeProgressState(content.data.progress);
}

/**
 * 読み → 変換 → 書き をユーザー単位で直列化して行う。
 *
 * 発音ストアと同じロックを共有しているので、2 つの機能が同じ子のファイルを
 * 同時に更新しても取りこぼさない。
 *
 * `mutate` が **同じ参照を返したら書かない**。たとえば同じ `answerId` の再送
 * (#76) は「数えない」ので、更新日時だけが動く空振り書き込みを避ける。
 */
async function mutateProgress(
  userId: string,
  mutate: (state: ProgressState) => ProgressState,
): Promise<MutationResult> {
  return withUserLock(userId, async () => {
    const content = await getUserContent(userId);
    const state = normalizeProgressState(content.data.progress);
    const next = mutate(state);
    if (next === state) return { state, changed: false };
    /* 既存のアトミック更新 (tmp + rename) をそのまま使う。他のキーは触らない */
    await updateUserContent(userId, { progress: next });
    return { state: next, changed: true };
  });
}

/**
 * クイズの回答を記録する (#76 から呼ぶ。1 問ごとに届く)。
 *
 * `duplicate: true` は「同じ回答を既に処理していた」= 何も足していない。
 * クライアントは成功として扱ってよい (リロードで 2 回送られても水増しされない)。
 */
export async function recordQuizRound(
  userId: string,
  input: QuizRoundInput,
): Promise<{ state: ProgressState; duplicate: boolean }> {
  const { state, changed } = await mutateProgress(userId, (current) => applyQuizRound(current, input));
  return { state, duplicate: !changed };
}

/**
 * カードを 1 枚めくったことを記録する (#76 から呼ぶ)。
 *
 * `duplicate: true` は「同じ `eventId` を既に処理していた」= 何も足していない。
 * 通信の再送や二重タップで数字が水増しされない。
 */
export async function recordCardView(
  userId: string,
  input: CardViewInput,
): Promise<{ state: ProgressState; duplicate: boolean }> {
  const { state, changed } = await mutateProgress(userId, (current) => applyCardView(current, input));
  return { state, duplicate: !changed };
}

/** 状態を直接置き換える (移行や保守用。通常は上の 2 つを使う) */
export async function saveProgressState(
  userId: string,
  next: ProgressState,
): Promise<ProgressState> {
  const { state } = await mutateProgress(userId, () => next);
  return state;
}
