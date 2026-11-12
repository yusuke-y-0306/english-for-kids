import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  TARGET_SAMPLE_RATE,
  resampleTo16k,
  wasmSupportBlocker,
} from "../../src/lib/speech/wasm-policy.ts";

/**
 * 端末内推論の環境判定とリサンプル — issue #79
 *
 * 固定したい主張:
 *  1. SharedArrayBuffer / cross-origin isolation が無いページでは **始めない**
 *     (無言で失敗するくらいなら、自己申告に落とす)
 *  2. Safari のように `AudioContext` のサンプルレートを指定できない端末でも、
 *     48kHz / 44.1kHz の音を 16kHz に直してモデルへ渡せる
 *  3. 変換は音の長さを保つ (1 秒の音が 1 秒のまま)
 */

const READY = {
  hasWebAssembly: true,
  hasSharedArrayBuffer: true,
  crossOriginIsolated: true,
  hasGetUserMedia: true,
  hasAudioContext: true,
};

describe("wasmSupportBlocker", () => {
  test("Safari (SAB + COOP/COEP + マイク) は使える", () => {
    assert.equal(wasmSupportBlocker(READY), null);
  });

  test("WebAssembly が無い", () => {
    assert.match(wasmSupportBlocker({ ...READY, hasWebAssembly: false }), /ブラウザ/);
  });

  test("SharedArrayBuffer が無い / isolation されていない (無言で死ぬので先に止める)", () => {
    assert.match(wasmSupportBlocker({ ...READY, hasSharedArrayBuffer: false }), /ページ/);
    assert.match(wasmSupportBlocker({ ...READY, crossOriginIsolated: false }), /ページ/);
  });

  test("マイクが無い", () => {
    assert.match(wasmSupportBlocker({ ...READY, hasGetUserMedia: false }), /マイク/);
  });

  test("AudioContext が無い", () => {
    assert.match(wasmSupportBlocker({ ...READY, hasAudioContext: false }), /マイクの おと/);
  });
});

describe("resampleTo16k", () => {
  test("16kHz はそのまま返す (コピーしない)", () => {
    const input = new Float32Array([0, 0.5, -0.5]);
    assert.equal(resampleTo16k(input, TARGET_SAMPLE_RATE), input);
  });

  test("48kHz の 1 秒は 16kHz の 16000 サンプルになる", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const output = resampleTo16k(input, 48_000);
    assert.equal(output.length, 16_000);
    assert.equal(output[0], 0.25);
    assert.equal(output[15_999], 0.25);
  });

  test("44.1kHz (Safari の実測値) でも長さが合う", () => {
    const input = new Float32Array(44_100);
    assert.equal(resampleTo16k(input, 44_100).length, 16_000);
  });

  test("ゆるやかな変化を保つ (線形補間)", () => {
    /* 48kHz で 0 → 1 に上がるランプ。16kHz でも単調増加で 0 から 1 に近づく */
    const input = new Float32Array(48_000);
    for (let i = 0; i < input.length; i += 1) input[i] = i / (input.length - 1);
    const output = resampleTo16k(input, 48_000);
    assert.equal(output[0], 0);
    assert.ok(output[8_000] > 0.49 && output[8_000] < 0.51);
    assert.ok(output[15_999] > 0.99);
    for (let i = 1; i < output.length; i += 1) {
      assert.ok(output[i] >= output[i - 1], "単調増加であること");
    }
  });

  test("不正なサンプルレートは素通し (落とさない)", () => {
    const input = new Float32Array([0.1, 0.2]);
    assert.equal(resampleTo16k(input, 0), input);
  });
});
