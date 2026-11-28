#!/usr/bin/env node
/**
 * 単語音声の生成 — issue #84
 *
 * `content/vocabulary/*.json` の各単語を edge-tts で mp3 にし、
 * `public/audio/words/<category>/<slug>.mp3` へ置く。あわせて
 *  - content JSON の `audio` フィールドを public パスで埋める
 *  - `public/audio/words/index.json` (オフライン用の一覧) を書き出す
 *
 * 声は端末に依存させない (生成物をリポジトリに置く)。生成時だけネットワークを使う。
 *
 * 準備: `pip install edge-tts` (pyenv 等なら `python3 -m pip install edge-tts`)
 *
 * 使い方:
 *   npm run audio:generate              # 未生成のものだけ
 *   npm run audio:generate -- --force   # 全部作り直す
 *   npm run audio:generate -- --dry-run # 何が足りないかだけ表示
 *   npm run audio:generate -- --voice=en-US-AnaNeural --rate=-20%
 *
 * 環境変数: `EDGE_TTS_PYTHON` (既定 `python3`)、`PYTHONPATH` はそのまま渡る。
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_WORD_AUDIO_BYTES,
  WORD_AUDIO_INDEX,
  audioFileForId,
  audioPathForId,
} from "../src/lib/audio/audio-assets.ts";

const DIRECTORY = path.join("content", "vocabulary");
const DEFAULT_VOICE = "en-US-JennyNeural";
const DEFAULT_RATE = "-10%";

function parseArgs(argv) {
  const options = { force: false, dryRun: false, voice: DEFAULT_VOICE, rate: DEFAULT_RATE };
  for (const arg of argv) {
    if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--voice=")) options.voice = arg.slice("--voice=".length);
    else if (arg.startsWith("--rate=")) options.rate = arg.slice("--rate=".length);
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

async function readSources() {
  const names = (await readdir(DIRECTORY)).filter((name) => name.endsWith(".json")).sort();
  const sources = [];
  for (const name of names) {
    const file = path.join(DIRECTORY, name);
    sources.push({ file, data: JSON.parse(await readFile(file, "utf8")) });
  }
  return sources;
}

function exists(file) {
  return stat(file).then(
    (info) => info.size > 0,
    () => false,
  );
}

function synthesize({ python, voice, rate, text, outFile }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      ["-m", "edge_tts", "--voice", voice, `--rate=${rate}`, "--text", text, "--write-media", outFile],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `edge-tts exited with ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const python = process.env.EDGE_TTS_PYTHON || "python3";
  const sources = await readSources();

  const words = [];
  for (const source of sources) {
    for (const word of source.data.words) {
      words.push({ word, file: source.file, data: source.data });
    }
  }

  const pending = [];
  for (const entry of words) {
    const outFile = audioFileForId(entry.word.id);
    if (options.force || !(await exists(outFile))) pending.push({ ...entry, outFile });
  }

  console.log(
    `${words.length} 語 / 未生成 ${pending.length} 語` +
      (options.dryRun ? " (dry-run)" : ` — voice=${options.voice} rate=${options.rate}`),
  );
  for (const entry of pending) console.log(`  ${options.dryRun ? "missing" : "generate"}: ${entry.word.id}`);

  if (options.dryRun) {
    if (pending.length > 0) process.exitCode = 1;
    return;
  }

  let generated = 0;
  let totalBytes = 0;
  const warnings = [];

  for (const entry of pending) {
    await mkdir(path.dirname(entry.outFile), { recursive: true });
    try {
      await synthesize({
        python,
        voice: options.voice,
        rate: options.rate,
        /* フォニーム音は `tts` で読みを差し替える (#88)。通常の語は `en` */
        text: entry.word.tts ?? entry.word.en,
        outFile: entry.outFile,
      });
    } catch (error) {
      throw new Error(
        `${entry.word.id}: 音声を生成できませんでした — ` +
          `${error instanceof Error ? error.message : error}\n` +
          `edge-tts が入っていますか? (pip install edge-tts)`,
      );
    }
    const size = (await stat(entry.outFile)).size;
    generated += 1;
    if (size > MAX_WORD_AUDIO_BYTES) {
      warnings.push(`${entry.word.id}: ${size} bytes は予算 (${MAX_WORD_AUDIO_BYTES}) 超え`);
    }
    process.stdout.write(`\r生成中… ${generated}/${pending.length}`);
  }
  if (pending.length > 0) process.stdout.write("\n");

  /* content JSON の `audio` を埋める (既に正しければ触らない) */
  const touched = new Set();
  for (const entry of words) {
    const audioPath = audioPathForId(entry.word.id);
    if (entry.word.audio !== audioPath) {
      entry.word.audio = audioPath;
      touched.add(entry.file);
    }
  }
  for (const source of sources) {
    if (!touched.has(source.file)) continue;
    await writeFile(source.file, `${JSON.stringify(source.data, null, 2)}\n`);
  }

  /* オフライン用の一覧。content に載っている順で書く */
  const indexPath = `public${WORD_AUDIO_INDEX}`;
  const urls = words.map((entry) => audioPathForId(entry.word.id));
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(urls, null, 2)}\n`);

  for (const entry of words) {
    const info = await stat(audioFileForId(entry.word.id));
    totalBytes += info.size;
  }

  console.log(
    `完了: 生成 ${generated} / 更新した JSON ${touched.size} / 合計 ${(totalBytes / 1024).toFixed(1)}KB`,
  );
  for (const warning of warnings) console.warn(`⚠️  ${warning}`);
}

main().catch((error) => {
  console.error(`audio generate failed — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
