#!/usr/bin/env node
/**
 * 語彙 JSON の検証 — issue #83
 *
 * `content/vocabulary/*.json` を読み、`src/lib/vocabulary/load.ts` の
 * 規則 (必須項目・ID 形式と重複・品詞/レベル・public パス) に通す。
 * ビルドでも同じ関数が走るが、こちらは **壊れたファイル名と位置**を
 * 先に出すための独立した入口 (CI の lint 段で落とす)。
 *
 * 使い方: npm run vocabulary:check
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { buildCategories } from "../src/lib/vocabulary/load.ts";

const DIRECTORY = path.join("content", "vocabulary");

async function main() {
  const names = (await readdir(DIRECTORY))
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (names.length === 0) {
    throw new Error(`${DIRECTORY} に JSON がありません`);
  }

  const sources = [];
  for (const name of names) {
    const relative = path.posix.join("content/vocabulary", name);
    let data;
    try {
      data = JSON.parse(await readFile(path.join(DIRECTORY, name), "utf8"));
    } catch (error) {
      throw new Error(
        `${relative}: JSON として読めません — ${error instanceof Error ? error.message : error}`,
      );
    }
    sources.push({ path: relative, data });
  }

  const categories = buildCategories(sources);
  const words = categories.reduce((total, category) => total + category.words.length, 0);

  console.log(
    `vocabulary OK: ${categories.length} categories / ${words} words (${names.join(", ")})`,
  );
}

main().catch((error) => {
  console.error(`vocabulary check failed — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
