#!/usr/bin/env node
/**
 * 単語音声の欠落・サイズ・一覧の検査 — issue #84
 *
 * CI で回す。次をすべて満たさなければ exit 1:
 *  - content の全単語に `audio` が入っていて、`audioPathForId(id)` と一致する
 *  - 実ファイルがあり、空でなく、1 語の予算 (40KB) 以内
 *  - MP3 として読める先頭バイト
 *  - `public/audio/words/index.json` が content と完全に一致する
 *  - 合計が総予算 (1MB) 以内
 *
 * 生成そのものはネットワークを使うので CI ではやらない (生成物はコミット済み)。
 *
 * 使い方: npm run audio:check
 */

import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  MAX_TOTAL_WORD_AUDIO_BYTES,
  MAX_WORD_AUDIO_BYTES,
  WORD_AUDIO_INDEX,
  audioFileForId,
  audioPathForId,
} from "../src/lib/audio/audio-assets.ts";

const DIRECTORY = path.join("content", "vocabulary");

/** MP3 の先頭は ID3 タグかフレーム同期 (0xFF 0xEx) */
async function looksLikeMp3(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead < 3) return false;
    if (buffer.subarray(0, 3).toString("latin1") === "ID3") return true;
    return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  } finally {
    await handle.close();
  }
}

async function main() {
  const errors = [];
  const names = (await readdir(DIRECTORY)).filter((name) => name.endsWith(".json")).sort();

  if (names.length === 0) {
    throw new Error(`${DIRECTORY} に JSON がありません`);
  }

  const expected = [];
  let totalBytes = 0;
  let largest = { id: "", bytes: 0 };

  for (const name of names) {
    const file = path.join(DIRECTORY, name);
    const data = JSON.parse(await readFile(file, "utf8"));

    for (const word of data.words) {
      const relative = `content/vocabulary/${name}`;
      const expectedPath = audioPathForId(word.id);

      if (word.audio === null || word.audio === undefined) {
        errors.push(`${relative}: ${word.id} の audio が null です (npm run audio:generate)`);
        continue;
      }
      if (word.audio !== expectedPath) {
        errors.push(`${relative}: ${word.id} の audio が "${expectedPath}" ではありません (${word.audio})`);
      }

      expected.push(expectedPath);

      const audioFile = audioFileForId(word.id);
      const info = await stat(audioFile).catch(() => null);
      if (!info || info.size === 0) {
        errors.push(`${word.id}: ${audioFile} がありません`);
        continue;
      }
      if (info.size > MAX_WORD_AUDIO_BYTES) {
        errors.push(
          `${word.id}: ${audioFile} が ${info.size} bytes で 1 語の予算 ${MAX_WORD_AUDIO_BYTES} を超えています`,
        );
      }
      if (!(await looksLikeMp3(audioFile))) {
        errors.push(`${word.id}: ${audioFile} が MP3 として読めません`);
      }

      totalBytes += info.size;
      if (info.size > largest.bytes) largest = { id: word.id, bytes: info.size };
    }
  }

  if (totalBytes > MAX_TOTAL_WORD_AUDIO_BYTES) {
    errors.push(
      `合計 ${(totalBytes / 1024).toFixed(1)}KB が総予算 ${MAX_TOTAL_WORD_AUDIO_BYTES / 1024}KB を超えています`,
    );
  }

  const indexFile = `public${WORD_AUDIO_INDEX}`;
  let index = null;
  try {
    index = JSON.parse(await readFile(indexFile, "utf8"));
  } catch {
    errors.push(`${indexFile} が読めません (npm run audio:generate)`);
  }

  if (index !== null) {
    if (!Array.isArray(index)) {
      errors.push(`${indexFile} は配列である必要があります`);
    } else {
      const missing = expected.filter((url) => !index.includes(url));
      const extra = index.filter((url) => !expected.includes(url));
      for (const url of missing) errors.push(`${indexFile} に ${url} がありません`);
      for (const url of extra) errors.push(`${indexFile} に content に無い ${url} があります`);
      if (missing.length === 0 && extra.length === 0 && index.length !== expected.length) {
        errors.push(`${indexFile} の件数 (${index.length}) が content (${expected.length}) と違います`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`audio check failed — ${errors.length} 件`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `audio OK: ${expected.length} 語 / 合計 ${(totalBytes / 1024).toFixed(1)}KB ` +
      `(最大 ${largest.id} ${(largest.bytes / 1024).toFixed(1)}KB, 予算 ${MAX_WORD_AUDIO_BYTES / 1024}KB/語)`,
  );
}

main().catch((error) => {
  console.error(`audio check failed — ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
