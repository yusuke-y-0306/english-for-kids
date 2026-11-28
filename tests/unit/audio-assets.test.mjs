import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import test, { describe } from "node:test";
import { promisify } from "node:util";

import {
  MAX_TOTAL_WORD_AUDIO_BYTES,
  MAX_WORD_AUDIO_BYTES,
  WORD_AUDIO_DIRECTORY,
  audioFileForId,
  audioPathForId,
} from "../../src/lib/audio/audio-assets.ts";

/**
 * 単語音声の土台 — issue #84
 *
 * ここで固定するのは「パスの規則」と「CI が見る検査が実際に通ること」。
 * 生成そのもの (edge-tts) はネットワークを使うのでテストしない。
 */

const run = promisify(execFile);

describe("audio-assets", () => {
  test("id から public パスを組み立てる", () => {
    assert.equal(audioPathForId("animals/dog"), "/audio/words/animals/dog.mp3");
    assert.equal(audioPathForId("family/mother"), "/audio/words/family/mother.mp3");
    assert.equal(audioFileForId("animals/dog"), "public/audio/words/animals/dog.mp3");
    assert.ok(audioPathForId("animals/dog").startsWith(`${WORD_AUDIO_DIRECTORY}/`));
  });

  test("ID の形が違えば組み立てない (パス脱出を許さない)", () => {
    for (const bad of ["animals", "animals/", "/dog", "animals/../dog", "Animals/Dog", "animals/dog.mp3"]) {
      assert.throws(() => audioPathForId(bad), /invalid word id/, bad);
    }
  });

  test("予算は 40KB/語・5MB 合計 (#88 で 344 語になった)", () => {
    assert.equal(MAX_WORD_AUDIO_BYTES, 40 * 1024);
    /* #88 でフォニックス 144 語が増え、344 語・実測 3.7MB になったため 5MB */
    assert.equal(MAX_TOTAL_WORD_AUDIO_BYTES, 5 * 1024 * 1024);
  });

  test("実際の音声が予算内に収まっている (ファイルシステム)", async () => {
    const info = await stat(audioFileForId("animals/dog"));
    assert.ok(info.size > 0);
    assert.ok(info.size <= MAX_WORD_AUDIO_BYTES);
  });

  test("audio:check (CI と同じ検査) が通る", async () => {
    const { stdout } = await run(process.execPath, [path.join("scripts", "audio-check.mjs")], {
      cwd: path.resolve("."),
    });
    assert.match(stdout, /audio OK: \d+ 語/);
  });
});
