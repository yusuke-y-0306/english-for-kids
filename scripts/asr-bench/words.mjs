#!/usr/bin/env node
/**
 * 計測用の単語リストを作る (issue #40)
 *
 * `src/lib/words.ts` が唯一の出典。手で書き写すとアプリとズレるので、
 * 収録ページが読む `public/lab/asr-bench/words.json` はここから生成する。
 *
 *   npm run bench:asr:words
 *
 * 選び方: カテゴリを巡回して 1 カテゴリ 3 語ずつ、合計 12 語。
 * 短い単語 (dog / cat) と長い単語 (elephant) が混ざるようにしてある。
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { categories, wordId } from "../../src/lib/words.ts";

const PER_CATEGORY = 3;
const LIMIT = 12;

const words = [];
for (let rank = 0; rank < PER_CATEGORY && words.length < LIMIT; rank += 1) {
  for (const category of categories) {
    const word = category.words[rank];
    if (!word || words.length >= LIMIT) continue;
    const entry = { id: wordId(category.id, word), en: word.en, ja: word.ja };
    // 採点の許容 (同音語・言い換え) は収録ページとレポートの両方が使うので一緒に配る
    if (word.homophones?.length) entry.homophones = word.homophones;
    if (word.variants?.length) entry.variants = word.variants;
    words.push(entry);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../public/lab/asr-bench/words.json");
const previous = await readFile(outPath, "utf8").catch(() => "");
const next = `${JSON.stringify(words, null, 2)}\n`;
await writeFile(outPath, next, "utf8");

console.log(
  previous === next
    ? `${outPath} は最新です (${words.length} 語)`
    : `${outPath} を更新しました (${words.length} 語)`,
);
for (const word of words) console.log(`  ${word.id.padEnd(16)} ${word.en}`);
