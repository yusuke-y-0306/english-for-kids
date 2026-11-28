import animals from "../../../content/vocabulary/animals.json" with { type: "json" };
import adjectives from "../../../content/vocabulary/adjectives.json" with { type: "json" };
import body from "../../../content/vocabulary/body.json" with { type: "json" };
import clothes from "../../../content/vocabulary/clothes.json" with { type: "json" };
import colors from "../../../content/vocabulary/colors.json" with { type: "json" };
import family from "../../../content/vocabulary/family.json" with { type: "json" };
import food from "../../../content/vocabulary/food.json" with { type: "json" };
import home from "../../../content/vocabulary/home.json" with { type: "json" };
import numbers from "../../../content/vocabulary/numbers.json" with { type: "json" };
import prepositions from "../../../content/vocabulary/prepositions.json" with { type: "json" };
import school from "../../../content/vocabulary/school.json" with { type: "json" };
import sports from "../../../content/vocabulary/sports.json" with { type: "json" };
import sightWords from "../../../content/vocabulary/sight-words.json" with { type: "json" };
import phonics from "../../../content/vocabulary/phonics.json" with { type: "json" };
import phonicsWords from "../../../content/vocabulary/phonics-words.json" with { type: "json" };
import wordFamilyAt from "../../../content/vocabulary/word-family-at.json" with { type: "json" };
import wordFamilyAn from "../../../content/vocabulary/word-family-an.json" with { type: "json" };
import wordFamilyIg from "../../../content/vocabulary/word-family-ig.json" with { type: "json" };
import wordFamilyOp from "../../../content/vocabulary/word-family-op.json" with { type: "json" };
import wordFamilyUg from "../../../content/vocabulary/word-family-ug.json" with { type: "json" };
import vehicles from "../../../content/vocabulary/vehicles.json" with { type: "json" };
import verbs from "../../../content/vocabulary/verbs.json" with { type: "json" };
import weather from "../../../content/vocabulary/weather.json" with { type: "json" };
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
  // #86: 品詞のバランスを取るために追加
  { path: "content/vocabulary/verbs.json", data: verbs },
  { path: "content/vocabulary/adjectives.json", data: adjectives },
  { path: "content/vocabulary/prepositions.json", data: prepositions },
  { path: "content/vocabulary/school.json", data: school },
  { path: "content/vocabulary/home.json", data: home },
  { path: "content/vocabulary/vehicles.json", data: vehicles },
  { path: "content/vocabulary/weather.json", data: weather },
  { path: "content/vocabulary/clothes.json", data: clothes },
  { path: "content/vocabulary/sports.json", data: sports },
  // #87: 絵で描けない高頻度語 (Dolch Pre-K)。「読む」への入口
  { path: "content/vocabulary/sight-words.json", data: sightWords },
  // #88: フォニックス。文字の音 (フォニーム) と CVC word family。
  // これらは専用の練習画面 (/phonics) で使うので、カード・クイズの一覧からは外す
  // (`words.ts` の `playCategories` を参照)
  { path: "content/vocabulary/phonics.json", data: phonics },
  { path: "content/vocabulary/phonics-words.json", data: phonicsWords },
  { path: "content/vocabulary/word-family-at.json", data: wordFamilyAt },
  { path: "content/vocabulary/word-family-an.json", data: wordFamilyAn },
  { path: "content/vocabulary/word-family-ig.json", data: wordFamilyIg },
  { path: "content/vocabulary/word-family-op.json", data: wordFamilyOp },
  { path: "content/vocabulary/word-family-ug.json", data: wordFamilyUg },
];

/**
 * 検証済みの語彙。壊れた JSON があれば **この module の評価時に throw** し、
 * `next build` / `next dev` がそのまま落ちる (画面は出ない)。
 */
export const categories: Category[] = buildCategories(vocabularySources);
