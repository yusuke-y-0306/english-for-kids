#!/usr/bin/env node
/**
 * 端末内音声認識エンジン (Moonshine WASM) を public/ へ配る — issue #79
 *
 *   node scripts/asr-engine.mjs           node_modules から public/asr/moonshine/ へコピー
 *   node scripts/asr-engine.mjs --check   コピー済みかを確認だけする (CI 用)
 *
 * 設計の要点:
 *  - エンジン (moonshine.mjs / moonshine.wasm) は **コード** なので、モデル (別オリジン)
 *    ではなくアプリと同じオリジンから配る (docs/speech-model-hosting.md の分担のとおり)。
 *  - 13MB のバイナリはリポジトリに入れない。npm の依存からビルド時にコピーする
 *    (`/public/asr/moonshine/` は .gitignore)。
 *  - 実行時に URL を組み立てない。配信先はこのスクリプトの定数と
 *    `src/lib/speech/wasm-recognition.ts` の定数で固定する。
 */

import { mkdir, readdir, stat, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "node_modules", "@moonshine-ai", "moonshine-wasm", "dist");
const DEST = path.join(ROOT, "public", "asr", "moonshine");

/** 配る拡張子。型定義・source map はブラウザに要らない */
const EXTENSIONS = new Set([".js", ".mjs", ".wasm"]);

/** 必須ファイル (欠けていたらビルドを止める) */
const REQUIRED = ["index.js", "module.js", "moonshine.mjs", "moonshine.wasm"];

async function sourceFiles() {
  const entries = await readdir(SRC, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    throw new Error(
      `@moonshine-ai/moonshine-wasm が見つかりません (${SRC})。先に \`npm ci\` を実行してください`,
    );
  }
  return entries
    .filter((entry) => entry.isFile() && EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const check = process.argv.includes("--check");
  const files = await sourceFiles();

  for (const name of REQUIRED) {
    if (!files.includes(name)) {
      throw new Error(`エンジンの必須ファイルがありません: ${name}`);
    }
  }

  if (check) {
    for (const name of files) {
      const info = await stat(path.join(DEST, name)).catch(() => null);
      if (!info) throw new Error(`未コピー: public/asr/moonshine/${name} (npm run asr:engine)`);
    }
    console.log(`OK: エンジン ${files.length} ファイルが public/asr/moonshine/ にあります`);
    return;
  }

  await mkdir(DEST, { recursive: true });

  /* 依存から消えたファイルを残さない (古いエンジンが配られ続けるのを防ぐ) */
  for (const name of await readdir(DEST)) {
    if (!files.includes(name)) await rm(path.join(DEST, name), { force: true });
  }

  let copied = 0;
  let skipped = 0;
  for (const name of files) {
    const source = path.join(SRC, name);
    const target = path.join(DEST, name);
    const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
    if (to && to.size === from.size && to.mtimeMs >= from.mtimeMs) {
      skipped += 1;
      continue;
    }
    await copyFile(source, target);
    copied += 1;
  }

  console.log(`engine: ${copied} コピー / ${skipped} スキップ -> public/asr/moonshine/`);
}

main().catch((error) => {
  console.error(`asr-engine: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
