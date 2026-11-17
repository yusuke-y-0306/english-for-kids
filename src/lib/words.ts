import { categories } from "./vocabulary/registry.ts";
import type { Word } from "./vocabulary/load.ts";

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
