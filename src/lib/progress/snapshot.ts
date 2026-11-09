import { getUserContent } from "@/lib/auth/content";
import { normalizePronunciationState } from "@/lib/speech/pronunciation-store";
import { allWordIds, categories } from "@/lib/words";
import { dayKeyOf } from "./day";
import { normalizeProgressState } from "./state";
import { streakOf } from "./streak";
import {
  summarizeCategories,
  summarizeDaily,
  summarizeWords,
  type CategoryProgress,
  type DailySlice,
  type WordMastery,
} from "./summary";

/**
 * 進捗スナップショット — 画面 (#68) と API (#67) が共有する「1 回分の集計」
 *
 * 同じ組み立てを 2 か所に書くと、片方だけ直して数字がずれる。ここで 1 回だけ
 * ファイルを読み、`summary.ts` / `streak.ts` の純粋関数に渡して組み立てる。
 * 画面も API も **この関数を通す** ので、表示と JSON が食い違わない。
 *
 * `userId` は呼び出し側 (Route Handler / Server Component) がセッションから
 * 取った値を渡すこと。リクエストの値をそのまま通すと他人の履歴を読める (IDOR)。
 */

export type ProgressStreak = {
  current: number;
  longest: number;
  studiedToday: boolean;
  lastStudyDay: string | null;
};

export type ProgressSnapshot = {
  /** JST の今日 (`YYYY-MM-DD`) */
  today: string;
  /** 直近 N 日の系列 (古い順・最後が today) */
  days: DailySlice[];
  streak: ProgressStreak;
  /** 手を付けた単語だけ (words.ts の並び順) */
  words: Record<string, WordMastery>;
  categories: CategoryProgress[];
  /** 発音の累計 (正は発音ストア。#66 の分担) */
  pronunciation: { totalAttempts: number; lastAttemptAt: string | null };
};

export type SnapshotOptions = {
  /** 直近何日ぶんか。未指定なら既定 (7)。1〜90 にクランプされる */
  days?: unknown;
  /** テスト用に「今日」を固定する。通常は省略 (JST の今日) */
  today?: string;
};

/** 1 ユーザーぶんの進捗を集計する (ファイルは 1 回だけ読む) */
export async function loadProgressSnapshot(
  userId: string,
  options: SnapshotOptions = {},
): Promise<ProgressSnapshot> {
  const content = await getUserContent(userId);
  const state = normalizeProgressState(content.data.progress);
  const pronunciation = normalizePronunciationState(content.data.pronunciation);
  const today = options.today ?? dayKeyOf();

  /* 入力は「どこに何が正か」を 1 か所にまとめて渡す (summary.ts は import を持たない) */
  const input = {
    days: state.days,
    words: state.words,
    pronunciation: pronunciation.byWord,
  };

  const streak = streakOf(state.days, today);

  return {
    today,
    days: summarizeDaily(input, { days: options.days, today }),
    streak: {
      current: streak.current,
      /* 保存値は保持期間 (400 日) より前の記録を持っていることがあるので長い方を採る */
      longest: Math.max(state.longestStreak, streak.longest),
      studiedToday: streak.studiedToday,
      lastStudyDay: streak.lastStudyDay,
    },
    words: summarizeWords(input, allWordIds()),
    categories: summarizeCategories(input, categories),
    pronunciation: {
      totalAttempts: pronunciation.totalAttempts,
      lastAttemptAt: pronunciation.lastAttemptAt,
    },
  };
}
