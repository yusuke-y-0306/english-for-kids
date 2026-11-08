import { getUserContent, updateUserContent } from "@/lib/auth/content";
import { dayKeyOf } from "@/lib/progress/day";
import {
  applyPronunciationAttempt,
  normalizeProgressState,
  seedWordsFromPronunciation,
} from "@/lib/progress/state";
import { withUserLock } from "@/lib/store/lock";
import { isPronunciationScore, type PronunciationScore } from "./scores";

/**
 * 発音練習の結果を保存する — issue #32
 *
 * 保存するのは **単語 ID と 3 段階スコアだけ**。
 * 音声そのもの・認識されたテキスト全文は保存しない (保存しないものは漏れない)。
 *
 * ストアは既存のユーザー単位 JSON (`data/content/<uid>.json`) の `data.pronunciation` を使う。
 * #4 (進捗管理) も同じストアに載る想定なので、キーは機能ごとに分けて衝突を避ける。
 */

export { PRONUNCIATION_SCORES, isPronunciationScore } from "./scores";
export type { PronunciationScore } from "./scores";

export type PronunciationWordState = {
  /** 直近の判定 */
  score: PronunciationScore;
  /** この単語を試した回数 */
  attempts: number;
  /** 最終挑戦日時 (ISO 8601) */
  updatedAt: string;
};

export type PronunciationState = {
  version: 1;
  /** 全単語合計の挑戦回数 */
  totalAttempts: number;
  /** 最後に挑戦した日時 (ISO 8601) */
  lastAttemptAt: string | null;
  /** 単語 ID → 状態 (単語数で上限が決まるので無限には増えない) */
  byWord: Record<string, PronunciationWordState>;
};

export const EMPTY_PRONUNCIATION_STATE: PronunciationState = {
  version: 1,
  totalAttempts: 0,
  lastAttemptAt: null,
  byWord: {},
};

/**
 * 保存済みの値を読み直して正規化する。
 * ファイルは自分たちが書いたものだが、**古い版や手編集で壊れていても落ちない**ようにする。
 */
export function normalizePronunciationState(raw: unknown): PronunciationState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PRONUNCIATION_STATE, byWord: {} };
  const source = raw as Partial<PronunciationState>;
  const byWord: Record<string, PronunciationWordState> = {};

  if (source.byWord && typeof source.byWord === "object") {
    for (const [id, value] of Object.entries(source.byWord)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<PronunciationWordState>;
      if (!isPronunciationScore(entry.score)) continue;
      const attempts = Number(entry.attempts);
      byWord[id] = {
        score: entry.score,
        attempts: Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString(),
      };
    }
  }

  const totalAttempts = Number(source.totalAttempts);
  return {
    version: 1,
    totalAttempts: Number.isFinite(totalAttempts) && totalAttempts >= 0 ? Math.floor(totalAttempts) : 0,
    lastAttemptAt: typeof source.lastAttemptAt === "string" ? source.lastAttemptAt : null,
    byWord,
  };
}

/**
 * ユーザーごとの直列化。
 *
 * `updateUserContent()` は read-modify-write なので、同じ子が連打すると
 * 更新が取りこぼされる。進捗 (#4) も同じファイルを書くため、ロックは
 * `src/lib/store/lock.ts` に切り出して **共有** している。
 */

/** 現在の状態を読む (存在しなければ空) */
export async function getPronunciationState(userId: string): Promise<PronunciationState> {
  const content = await getUserContent(userId);
  return normalizePronunciationState(content.data.pronunciation);
}

/**
 * 1 回分の結果を記録する。
 *
 * `userId` は **呼び出し側 (Route Handler) がセッションから取った値**を渡すこと。
 * リクエストボディの値を通してはいけない (issue #32 の本体)。
 *
 * 進捗 (#4) の日次も **同じロック・同じ read-modify-write の中で** 更新する (#66)。
 * `data/pronunciation` と `data/progress` は同じファイルなので、2 回書くと
 * 「片方だけ書けた」中途半端な状態が生まれる (取りこぼしの窓を作らない)。
 * そのため `updateUserContent()` の呼び出しは **このメソッド全体で 1 回だけ** にする。
 */
export async function recordPronunciationAttempt(
  userId: string,
  wordId: string,
  score: PronunciationScore,
  now: Date = new Date(),
): Promise<PronunciationState> {
  return withUserLock(userId, async () => {
    const content = await getUserContent(userId);
    const state = normalizePronunciationState(content.data.pronunciation);
    const previous = state.byWord[wordId];
    const at = now.toISOString();

    const next: PronunciationState = {
      version: 1,
      totalAttempts: state.totalAttempts + 1,
      lastAttemptAt: at,
      byWord: {
        ...state.byWord,
        [wordId]: {
          score,
          attempts: (previous?.attempts ?? 0) + 1,
          updatedAt: at,
        },
      },
    };

    /* 進捗の日次 (#66)。ok だけが「できた」に数えられる。
       種まきに渡すのは **この試行を足す前** の byWord。いま記録する 1 回は
       下の applyPronunciationAttempt が日次に入れるので、単語別に二重で入れない */
    const seeded = seedWordsFromPronunciation(
      normalizeProgressState(content.data.progress),
      state.byWord,
      at,
    );
    const nextProgress = applyPronunciationAttempt(seeded, {
      day: dayKeyOf(now),
      ok: score === "ok",
      now: at,
    });

    /* 既存のアトミック更新 (tmp + rename) をそのまま使う。
       発音と進捗を **1 回の書き込み** でまとめる (部分更新の窓を作らない) */
    await updateUserContent(userId, { pronunciation: next, progress: nextProgress });
    return next;
  });
}
