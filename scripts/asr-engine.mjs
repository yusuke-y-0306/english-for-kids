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

import { mkdir, readdir, stat, copyFile, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "node_modules", "@moonshine-ai", "moonshine-wasm", "dist");
const DEST = path.join(ROOT, "public", "asr", "moonshine");

/** 配る拡張子。型定義・source map はブラウザに要らない */
const EXTENSIONS = new Set([".js", ".mjs", ".wasm"]);

/** 必須ファイル (欠けていたらビルドを止める) */
const REQUIRED = ["index.js", "module.js", "moonshine.mjs", "moonshine.wasm"];

/**
 * pthread プールの上限 — issue #2 (iPhone でモデルの読み込みが終わらない)
 *
 * Emscripten は `navigator.hardwareConcurrency` の数だけ Worker を作り、
 * **Worker ごとに 13MB の wasm をコンパイルする**。iPhone は 6 コアなので
 * 起動時に 6 回コンパイルが走り、Safari では 40 秒以上かかったうえ
 * 終わらないことがある (推論そのものより準備が重い)。
 *
 * 上流 (生成物) に設定項目が無いので、**配る時点でプールを絞る**。
 * 置換は 1 箇所だけ・冪等。上流のコードが変わって置換できなくなったら
 * ビルドを止める (黙って無効化させない)。
 */
const THREAD_POOL_PATCH = {
  file: "moonshine.mjs",
  from: "var pthreadPoolSize=navigator.hardwareConcurrency;",
  to: "var pthreadPoolSize=Math.min(navigator.hardwareConcurrency,2);",
};

/** 生成物の pthread プール上限を書き換える (純粋関数。テストで固定する) */
export function patchThreadPool(source, patch = THREAD_POOL_PATCH) {
  if (source.includes(patch.to)) return source; // 適用済み
  if (!source.includes(patch.from)) {
    throw new Error(
      `エンジンの pthread プール設定が見つかりません (${patch.file})。上流の生成物が変わりました`,
    );
  }
  return source.replace(patch.from, patch.to);
}

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
    /* pthread プールの上限が入っているかも確認する (issue #2) */
    const mjs = await readFile(path.join(DEST, THREAD_POOL_PATCH.file), "utf8").catch(() => "");
    if (!mjs.includes(THREAD_POOL_PATCH.to)) {
      throw new Error(
        `pthread プールの上限が未適用です: public/asr/moonshine/${THREAD_POOL_PATCH.file} (npm run asr:engine)`,
      );
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

  /* コピーした生成物に pthread プールの上限を入れる (issue #2) */
  const patchedPath = path.join(DEST, THREAD_POOL_PATCH.file);
  const original = await readFile(patchedPath, "utf8");
  const patched = patchThreadPool(original);
  if (patched !== original) {
    await writeFile(patchedPath, patched);
    console.log(`engine: pthread プールを 2 に制限 -> ${THREAD_POOL_PATCH.file}`);
  }

  console.log(`engine: ${copied} コピー / ${skipped} スキップ -> public/asr/moonshine/`);
}

/* 直接実行されたときだけ動く (テストから import できるようにする) */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`asr-engine: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
