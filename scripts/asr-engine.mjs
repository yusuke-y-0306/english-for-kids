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

/**
 * Worker へ wasm モジュールを渡せない環境へのフォールバック — issue #2
 *
 * Emscripten は起動時に、コンパイル済みの `WebAssembly.Module` を
 * `postMessage` で各 Worker に配る:
 *
 *   worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})
 *   worker.onerror = e => { ...; throw e }        // ← 例外を投げるだけ
 *   let pthreadPoolReady = Promise.all(unusedWorkers.map(loadWasmModuleToWorker))
 *   pthreadPoolReady.then(onMaybeReady)           // ← catch が無い
 *
 * Safari は `WebAssembly.Module` の構造化クローンに対応していないため、
 * この `postMessage` が DataCloneError で落ちる。Promise が解決しないまま
 * `onMaybeReady` が呼ばれず、**モデルの読み込みが永久に終わらない**
 * (エラーも出ないので「固まった」ように見える)。
 *
 * そこで「渡せなければ渡さずに送り直す」ようにする。Worker 側は自分で
 * 13MB の wasm を取得・コンパイルする (プールは 2 に絞ってあるので 2 回)。
 */
const WORKER_LOAD_PATCH = {
  file: "moonshine.mjs",
  from: 'worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})',
  to:
    'try{worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})}' +
    'catch(_e){console.error("[asr] wasmModule を Worker に渡せませんでした。Worker 側で読み込みます",_e);' +
    'worker.postMessage({cmd:"load",handlers,wasmMemory})}',
};

/** 配る生成物に当てるパッチ (順番に適用する) */
export const ENGINE_PATCHES = [THREAD_POOL_PATCH, WORKER_LOAD_PATCH];

/** 生成物 1 箇所を置換する (冪等。置換できなければ例外) */
export function applyPatch(source, patch) {
  if (source.includes(patch.to)) return source; // 適用済み
  if (!source.includes(patch.from)) {
    throw new Error(
      `エンジンの置換対象が見つかりません (${patch.file})。上流の生成物が変わりました: ${patch.from}`,
    );
  }
  return source.replace(patch.from, patch.to);
}

/** 生成物の pthread プール上限を書き換える (後方互換のための別名) */
export function patchThreadPool(source, patch = THREAD_POOL_PATCH) {
  return applyPatch(source, patch);
}

/** 生成物に必要なパッチをすべて当てる */
export function patchEngine(source) {
  return ENGINE_PATCHES.reduce((current, patch) => applyPatch(current, patch), source);
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
    /* パッチが当たっているかも確認する (issue #2) */
    const mjs = await readFile(path.join(DEST, THREAD_POOL_PATCH.file), "utf8").catch(() => "");
    for (const patch of ENGINE_PATCHES) {
      if (!mjs.includes(patch.to)) {
        throw new Error(
          `未適用のパッチがあります: public/asr/moonshine/${patch.file} (npm run asr:engine)`,
        );
      }
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

  /* コピーした生成物に Safari 向けのパッチを当てる (issue #2) */
  const patchedPath = path.join(DEST, THREAD_POOL_PATCH.file);
  const original = await readFile(patchedPath, "utf8");
  const patched = patchEngine(original);
  if (patched !== original) {
    await writeFile(patchedPath, patched);
    console.log(`engine: Safari 向けパッチ ${ENGINE_PATCHES.length} 件 -> ${THREAD_POOL_PATCH.file}`);
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
