#!/usr/bin/env node
/**
 * 収録した音声を Moonshine (WASM) に通して仮説を書き戻す (issue #40)
 *
 *   node scripts/asr-bench/moonshine.mjs ~/Downloads/asr-bench-*.json -o bench.moonshine.json
 *
 * モデルは**自前のキャッシュから読む** (CDN は使わない)。
 * 無ければ先に `npm run models:fetch` を実行する。
 * 別のディレクトリを使うときは `--model-dir`。
 *
 * 依存は `@moonshine-ai/moonshine-wasm` だけ (ブラウザ不要)。
 * リポジトリの依存には入れていないので、必要になったら:
 *   npm i --no-save @moonshine-ai/moonshine-wasm
 *
 * ここで出るのは**仮説テキスト**だけ。判定は report.mjs がアプリと同じ
 * `scorePronunciation()` で行う (計測用に採点を書き直さない)。
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const TARGET_RATE = 16000;

/** ストリーミングモデルの構成ファイル */
const STREAMING_FILES = [
  "frontend.ort",
  "encoder.ort",
  "adapter.ort",
  "cross_kv.ort",
  "decoder_kv.ort",
  "streaming_config.json",
  "tokenizer.bin",
];

function parseArgs(argv) {
  const options = { input: null, output: null, modelDir: null, arch: "TinyStreaming" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") options.output = argv[++i];
    else if (arg === "--model-dir") options.modelDir = argv[++i];
    else if (arg === "--arch") options.arch = argv[++i];
    else if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "使い方: node scripts/asr-bench/moonshine.mjs <collected.json> [-o out.json]",
          "        [--model-dir DIR] [--arch TinyStreaming|BaseStreaming]",
        ].join("\n"),
      );
      process.exit(0);
    } else if (!arg.startsWith("-")) options.input = arg;
  }
  return options;
}

async function importMoonshine() {
  try {
    return await import("@moonshine-ai/moonshine-wasm");
  } catch {
    throw new Error(
      "@moonshine-ai/moonshine-wasm がありません。`npm i --no-save @moonshine-ai/moonshine-wasm` を実行してください。",
    );
  }
}

/** `models-cache/<arch>/<量子化>_<日付>/` を探す (見つからなければ null) */
async function findDefaultModelDir() {
  const base = join(ROOT, "models-cache");
  let archDirs = [];
  try {
    archDirs = await readdir(base);
  } catch {
    return null;
  }
  for (const archDir of archDirs) {
    const full = join(base, archDir);
    let children = [];
    try {
      children = await readdir(full);
    } catch {
      continue;
    }
    for (const child of children.sort().reverse()) {
      const candidate = join(full, child);
      const entries = await readdir(candidate).catch(() => []);
      if (STREAMING_FILES.every((name) => entries.includes(name))) return candidate;
    }
  }
  return null;
}

async function loadModelFiles(modelDir) {
  const entries = await readdir(modelDir).catch(() => []);
  if (!entries.length) throw new Error(`${modelDir} がありません。先に \`npm run models:fetch\` を実行してください。`);
  const files = new Map();
  for (const name of STREAMING_FILES) {
    if (!entries.includes(name)) continue;
    files.set(name, new Uint8Array(await readFile(join(modelDir, name))));
  }
  if (files.size === 0) throw new Error(`${modelDir} にモデルのファイルがありません`);
  return files;
}

/** PCM16 / モノラルの WAV を Float32 にする (収録ページの出力形式) */
function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag !== "RIFF") throw new Error("WAV ではありません");
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (bits !== 16) throw new Error(`PCM16 のみ対応 (${bits} bit)`);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const frames = Math.floor(size / (channels * 2));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          sum += view.getInt16(offset + 8 + (i * channels + channel) * 2, true) / 0x8000;
        }
        mono[i] = sum / channels;
      }
      return { samples: mono, rate, channels };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("data チャンクがありません");
}

/**
 * 16kHz へ線形リサンプル。
 * 収録ページの出力は 16kHz なので通常は何もしない (jfk.wav のような外部素材用)。
 */
function resampleLinear(samples, fromRate) {
  if (fromRate === TARGET_RATE) return samples;
  const frames = Math.max(1, Math.round((samples.length * TARGET_RATE) / fromRate));
  const out = new Float32Array(frames);
  const ratio = fromRate / TARGET_RATE;
  for (let i = 0; i < frames; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(samples.length - 1, index + 1);
    const frac = position - index;
    out[i] = samples[index] * (1 - frac) + samples[next] * frac;
  }
  return out;
}

function meanConfidence(words) {
  const values = words.map((word) => word.confidence).filter((value) => typeof value === "number");
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input) {
    console.error("収録した JSON を指定してください (例: asr-bench-*.json)");
    process.exit(2);
  }

  const collected = JSON.parse(await readFile(options.input, "utf8"));
  const clips = (collected.clips ?? []).filter((clip) => clip.wavBase64);
  if (!clips.length) {
    console.error("音声 (wavBase64) が入っていません。収録ページで録り直してください。");
    process.exit(2);
  }

  const modelDir = options.modelDir ? resolve(options.modelDir) : await findDefaultModelDir();
  if (!modelDir) throw new Error("モデルのキャッシュが見つかりません。`npm run models:fetch` を実行してください。");
  console.log(`モデル: ${modelDir}`);

  const { Transcriber, ModelArch } = await importMoonshine();
  const files = await loadModelFiles(modelDir);

  const loadStart = performance.now();
  const transcriber = await Transcriber.load({ files, modelArch: ModelArch[options.arch] });
  const loadMs = Math.round(performance.now() - loadStart);
  console.log(`ロード: ${loadMs}ms / ${clips.length} 件を推論します…`);

  const results = [];
  try {
    for (const clip of clips) {
      try {
        const wav = decodeWav(new Uint8Array(Buffer.from(clip.wavBase64, "base64")));
        const audio = resampleLinear(wav.samples, wav.rate);
        const start = performance.now();
        const out = await transcriber.transcribe(audio, { sampleRate: TARGET_RATE });
        const inferMs = Math.round(performance.now() - start);
        const words = out.lines.flatMap((line) => line.words ?? []);
        const row = {
          wordId: clip.wordId,
          expected: clip.expected,
          transcript: out.lines
            .map((line) => line.text)
            .join(" ")
            .trim(),
          inferMs,
          audioSec: Number((audio.length / TARGET_RATE).toFixed(2)),
          confidence: meanConfidence(words),
          sourceRate: wav.rate,
        };
        results.push(row);
        console.log(`  ${clip.expected} → ${JSON.stringify(row.transcript)} (${inferMs}ms, conf ${row.confidence})`);
      } catch (error) {
        results.push({ wordId: clip.wordId, expected: clip.expected, error: String(error?.message ?? error) });
        console.log(`  ${clip.expected} → 失敗: ${String(error?.message ?? error)}`);
      }
    }
  } finally {
    try {
      transcriber.close();
    } catch {
      // すでに閉じている
    }
  }

  const byWord = new Map(results.map((row) => [row.wordId, row]));
  const merged = {
    ...collected,
    moonshine: { arch: options.arch, loadMs, ranAt: new Date().toISOString(), modelDir },
    clips: (collected.clips ?? []).map((clip) => ({
      ...clip,
      moonshine: byWord.get(clip.wordId) ?? null,
    })),
  };

  const output = options.output ?? `${options.input.replace(/\.json$/, "")}.moonshine.json`;
  await writeFile(output, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`書き出しました: ${output}`);
  console.log(`次: node scripts/asr-bench/report.mjs ${output}`);
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
