import { categories } from "./vocabulary/registry.ts";
import type { Category, Word } from "./vocabulary/load.ts";

/**
 * 語彙の互換アダプタ — issue #83
 *
 * 語そのものは `content/vocabulary/*.json` に移した。画面・クイズ・進捗からは
 * 従来どおりこの module を import する (`categories` / `wordId` / `findWordById`)。
 * データの形と検証は `src/lib/vocabulary/load.ts` が正。
 */

export type { Category, CefrLevel, Word, WordPos } from "./vocabulary/load.ts";
export { wordId } from "./vocabulary/load.ts";
export { categories };

/* ------------------------------------------------------------------ */
/* 練習専用カテゴリ (issue #88)                                        */
/* ------------------------------------------------------------------ */

/**
 * フォニックス専用のカテゴリ ID の接頭辞。
 *
 * アルファベット (`phonics`) と CVC word family (`word-family-*`) は
 * **専用の練習画面でだけ**使う。カード一覧・クイズ・きょうのカードに混ざると
 * 「a」「sat」のような語が一般語彙に並んでしまうため、遊びの一覧からは外す。
 *
 * ただし `categories` からは外さない — 進捗と発音は `wordId` で引くので、
 * `findWordById()` と進捗画面には載っている必要がある。
 */
const PRACTICE_ONLY_PREFIXES = ["phonics", "word-family-"] as const;

/** 練習専用カテゴリか (カード・クイズに出さない) */
export function isPracticeOnlyCategory(categoryId: string): boolean {
  return PRACTICE_ONLY_PREFIXES.some((prefix) => categoryId.startsWith(prefix));
}

/** カード・クイズ・きょうのカードで使うカテゴリ (フォニックスを除いたもの) */
export const playCategories: Category[] = categories.filter(
  (category) => !isPracticeOnlyCategory(category.id),
);

/* ------------------------------------------------------------------ */
/* 単語 ID (issue #32 / #83)                                           */
/* ------------------------------------------------------------------ */

export type IdentifiedWord = {
  id: string;
  categoryId: string;
  word: Word;
};

const WORDS_BY_ID: ReadonlyMap<string, IdentifiedWord> = new Map(
  categories.flatMap((category) =>
    category.words.map((word): [string, IdentifiedWord] => [
      word.id,
      { id: word.id, categoryId: category.id, word },
    ]),
  ),
);

/** ID から単語を引く。無ければ null (ホワイトリストとして使う) */
export function findWordById(id: string): IdentifiedWord | null {
  return WORDS_BY_ID.get(id) ?? null;
}

/** 存在する単語 ID の一覧 */
export function allWordIds(): string[] {
  return [...WORDS_BY_ID.keys()];
}
