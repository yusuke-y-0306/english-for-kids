import animals from "../../../content/vocabulary/animals.json" with { type: "json" };
import body from "../../../content/vocabulary/body.json" with { type: "json" };
import colors from "../../../content/vocabulary/colors.json" with { type: "json" };
import family from "../../../content/vocabulary/family.json" with { type: "json" };
import food from "../../../content/vocabulary/food.json" with { type: "json" };
import numbers from "../../../content/vocabulary/numbers.json" with { type: "json" };
import { buildCategories, type Category, type VocabularySource } from "./load.ts";

/**
 * 語彙ファイルの一覧 — issue #83
 *
 * `content/vocabulary/*.json` は **静的に import する**。実行時に fs で読むと
 * クライアントコンポーネント (カード / 発音) へデータを渡せないため。
 * 追加したらこの配列にも足すこと (`tests/unit/vocabulary.test.mjs` が
 * ディレクトリとの一致を検査する)。
 */
export const vocabularySources: VocabularySource[] = [
  { path: "content/vocabulary/animals.json", data: animals },
  { path: "content/vocabulary/food.json", data: food },
  { path: "content/vocabulary/colors.json", data: colors },
  { path: "content/vocabulary/numbers.json", data: numbers },
  { path: "content/vocabulary/body.json", data: body },
  { path: "content/vocabulary/family.json", data: family },
];

/**
 * 検証済みの語彙。壊れた JSON があれば **この module の評価時に throw** し、
 * `next build` / `next dev` がそのまま落ちる (画面は出ない)。
 */
export const categories: Category[] = buildCategories(vocabularySources);
