#!/usr/bin/env node
/**
 * 計測結果を Markdown の表にする (issue #40)
 *
 *   node scripts/asr-bench/report.mjs bench.moonshine.json
 *
 * 判定はアプリ本体と同じ `scorePronunciation()` を使う。
 * 計測用に採点を書き直すと「本番と違う基準で比べる」ことになるので禁止。
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scorePronunciation } from "../../src/lib/speech/scoring.ts";

const MARKS = { ok: "🎉", close: "😊", retry: "🔁" };
const WORDS_JSON = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/lab/asr-bench/words.json",
);

/**
 * 単語ごとの許容 (同音語・言い換え) を words.json から引く。
 * 出典は収録ページと同じ (`src/lib/words.ts` から生成) なので、アプリ本体と判定がズレない。
 */
async function loadScoreOptions() {
  try {
    const words = JSON.parse(await readFile(WORDS_JSON, "utf8"));
    const map = new Map();
    for (const word of words) {
      map.set(word.id, { homophones: word.homophones, variants: word.variants });
    }
    return map;
  } catch {
    return new Map();
  }
}

function judge(transcript, expected, options) {
  if (!transcript) return { score: "retry", distance: null, hint: "認識できず" };
  return scorePronunciation(transcript, expected, options);
}

/** 1 エンジンぶんの集計 */
function summarize(rows, field, optionsById) {
  const stats = { ok: 0, close: 0, retry: 0, missing: 0, exact: 0, latencies: [] };
  for (const row of rows) {
    const engine = row[field];
    if (!engine || engine.error) {
      stats.missing += 1;
      continue;
    }
    const transcript = engine.transcript ?? "";
    const result = judge(transcript, row.expected, optionsById.get(row.wordId));
    stats[result.score] += 1;
    if (transcript.trim().toLowerCase() === row.expected.toLowerCase()) stats.exact += 1;
    if (typeof engine.ms === "number") stats.latencies.push(engine.ms);
    if (typeof engine.inferMs === "number") stats.latencies.push(engine.inferMs);
  }
  const mean = (list) =>
    list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
  return { ...stats, meanMs: mean(stats.latencies), total: rows.length };
}

function line(name, stats) {
  const parts = [
    `${name}: 🎉${stats.ok} / 😊${stats.close} / 🔁${stats.retry}`,
    `(n=${stats.total}`,
  ];
  if (stats.missing) parts.push(`/ 認識できず ${stats.missing}`);
  if (stats.meanMs !== null) parts.push(`/ 平均 ${stats.meanMs}ms`);
  parts.push(")");
  return parts.join(" ");
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("使い方: node scripts/asr-bench/report.mjs <collected.json>");
    process.exit(2);
  }
  const data = JSON.parse(await readFile(input, "utf8"));
  const rows = data.clips ?? [];
  if (!rows.length) {
    console.error("clips が空です");
    process.exit(2);
  }

  const optionsById = await loadScoreOptions();
  const hasDevice = rows.some((row) => row.device);
  const hasMoonshine = rows.some((row) => row.moonshine);

  console.log(`# 音声認識の計測 (${rows.length} 語)`);
  console.log("");
  if (data.deviceReport) {
    console.log(`- 端末: ${data.userAgent ?? "不明"}`);
    console.log(`- 端末内認識の申告: \`${JSON.stringify(data.deviceReport)}\``);
  }
  if (data.moonshine) {
    console.log(`- Moonshine: ${data.moonshine.arch} / モデルのロード ${data.moonshine.loadMs}ms`);
  }
  console.log("");

  console.log("| 単語 | 端末内認識 | 判定 | Moonshine | 判定 | 推論 |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const device = row.device;
    const moon = row.moonshine;
    const deviceText = device && !device.error ? `\`${device.transcript}\`` : "—";
    const moonText = moon && !moon.error ? `\`${moon.transcript}\`` : "—";
    const options = optionsById.get(row.wordId);
    const deviceScore =
      device && !device.error ? MARKS[judge(device.transcript, row.expected, options).score] : "—";
    const moonScore =
      moon && !moon.error ? MARKS[judge(moon.transcript, row.expected, options).score] : "—";
    const infer = moon && typeof moon.inferMs === "number" ? `${moon.inferMs}ms` : "—";
    console.log(`| ${row.expected} | ${deviceText} | ${deviceScore} | ${moonText} | ${moonScore} | ${infer} |`);
  }
  console.log("");

  if (hasDevice) {
    const device = summarize(rows, "device", optionsById);
    console.log(`- ${line("端末内認識", device)}`);
    if (device.exact) console.log(`  完全一致 ${device.exact}/${rows.length}`);
  }
  if (hasMoonshine) {
    const moonshine = summarize(rows, "moonshine", optionsById);
    console.log(`- ${line("Moonshine", moonshine)}`);
    if (moonshine.exact) console.log(`  完全一致 ${moonshine.exact}/${rows.length}`);
  }

  // 判定が割れた単語を先に見る (どちらが厳しすぎるかはここで分かる)
  if (hasDevice && hasMoonshine) {
    const disagree = rows.filter((row) => {
      const options = optionsById.get(row.wordId);
      const a = row.device && !row.device.error ? judge(row.device.transcript, row.expected, options).score : null;
      const b =
        row.moonshine && !row.moonshine.error ? judge(row.moonshine.transcript, row.expected, options).score : null;
      return a !== b;
    });
    console.log("");
    console.log(`## 判定が割れた単語 (${disagree.length} 件)`);
    for (const row of disagree) {
      const a = row.device?.transcript ?? "—";
      const b = row.moonshine?.transcript ?? "—";
      console.log(`- ${row.expected}: 端末内 \`${a}\` / Moonshine \`${b}\``);
    }
    if (!disagree.length) console.log("- なし (全一致)");
  }

  // 正しく言えているのに弾いたものは、必ず人が見る (子ども向けで一番致命的)
  const falseNegatives = rows.filter((row) => {
    const engine = row.moonshine ?? row.device;
    if (!engine || engine.error) return false;
    return judge(engine.transcript, row.expected, optionsById.get(row.wordId)).score === "retry";
  });
  if (falseNegatives.length) {
    console.log("");
    console.log(`## 🔁 retry になった単語 (${falseNegatives.length} 件 / 誤検出か録音環境かを人が確認する)`);
    for (const row of falseNegatives) {
      console.log(
        `- ${row.expected} → 端末内 \`${row.device?.transcript ?? "—"}\` / Moonshine \`${row.moonshine?.transcript ?? "—"}\``,
      );
    }
  }
  console.log("");
  console.log("※ 端末内認識と録音は同時に取っているが、認識側の前処理 (AEC/NS) はブラウザ任せ。");
  console.log("   厳密な同一音声での比較ではないので、差が小さいときは「同等」と読む。");
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
