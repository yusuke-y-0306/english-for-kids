import assert from "node:assert/strict";
import test from "node:test";

import { decideRecognitionPath } from "../../src/lib/speech/recognition-policy.ts";

/**
 * 経路決定の仕様を固定する — issue #31 / #40
 *
 * ここは「子どもが言えたのに もういちど と出る」事故を防ぐ最後の砦なので、
 * **判断表そのもの**をテストで固定する。ブラウザ API は触らない (純粋関数)。
 *
 * #40 で変わったこと: 使えるなら `device` を優先する (`wasm` はその代替)。
 * 変わっていないこと: クラウドに落ちる実装は、精度が高くても使わない。
 */

// 端末内認識が「使える」端末 (Chrome / Android で言語パック導入済み)
const DEVICE_OK = { present: true, hasProcessLocally: true, availability: "available" };
// 言語パックが未取得 (Chrome の初期状態はよくこれ)
const DEVICE_DOWNLOADABLE = {
  present: true,
  hasProcessLocally: true,
  availability: "downloadable",
};
const DEVICE_DOWNLOADING = { present: true, hasProcessLocally: true, availability: "downloading" };
const DEVICE_UNAVAILABLE = { present: true, hasProcessLocally: true, availability: "unavailable" };
// Safari: `webkitSpeechRecognition` は processLocally を持たない (事実上クラウド)
const SAFARI = { present: true, hasProcessLocally: false };
// Firefox のように SpeechRecognition 自体が無い
const NO_API = { present: false, hasProcessLocally: false };

test("両方使えるなら device を優先する (精度優先・issue #40)", () => {
  const decision = decideRecognitionPath({ wasmReady: true, device: DEVICE_OK });
  assert.equal(decision.path, "device");
  assert.match(decision.reason, /端末内の よみとり/);
});

test("prefer: wasm なら両方使えるときに wasm を使う (計測用)", () => {
  const decision = decideRecognitionPath({ wasmReady: true, device: DEVICE_OK, prefer: "wasm" });
  assert.equal(decision.path, "wasm");
  assert.match(decision.reason, /アプリ内のモデル/);
});

test("prefer: wasm でも wasm が無ければ device に落ちる", () => {
  const decision = decideRecognitionPath({ wasmReady: false, device: DEVICE_OK, prefer: "wasm" });
  assert.equal(decision.path, "device");
});

test("device だけ使えるなら device", () => {
  assert.equal(decideRecognitionPath({ wasmReady: false, device: DEVICE_OK }).path, "device");
});

test("device が downloadable/downloading でも wasm があれば wasm で認識する", () => {
  for (const device of [DEVICE_DOWNLOADABLE, DEVICE_DOWNLOADING]) {
    const decision = decideRecognitionPath({ wasmReady: true, device });
    assert.equal(decision.path, "wasm", String(device.availability));
  }
});

test("device が downloadable で wasm が無ければ自己申告 (理由は「ようい できていない」)", () => {
  const decision = decideRecognitionPath({ wasmReady: false, device: DEVICE_DOWNLOADABLE });
  assert.equal(decision.path, "self-report");
  assert.match(decision.reason, /まだ ようい できていません/);
});

test("device が unavailable でも wasm があれば wasm", () => {
  assert.equal(decideRecognitionPath({ wasmReady: true, device: DEVICE_UNAVAILABLE }).path, "wasm");
});

test("Safari (processLocally 無し) でも wasm があれば wasm を使う", () => {
  const decision = decideRecognitionPath({ wasmReady: true, device: SAFARI });
  assert.equal(decision.path, "wasm");
  // クラウド実装に落ちる経路は選ばない、が最優先の不変条件 (#31)
  assert.notEqual(decision.path, "device");
});

test("Safari で wasm も無ければ自己申告。理由は「クラウドだから つかいません」", () => {
  const decision = decideRecognitionPath({ wasmReady: false, device: SAFARI });
  assert.equal(decision.path, "self-report");
  assert.match(decision.reason, /クラウドで おこなわれるため つかいません/);
});

test("SpeechRecognition が無い端末でも wasm があれば wasm (テスト用 Chromium がこれ)", () => {
  assert.equal(decideRecognitionPath({ wasmReady: true, device: NO_API }).path, "wasm");
});

test("SpeechRecognition も wasm も無ければ自己申告", () => {
  const decision = decideRecognitionPath({ wasmReady: false, device: NO_API });
  assert.equal(decision.path, "self-report");
  assert.match(decision.reason, /よみとりが つかえません/);
});

test("available() が無い実装 (undefined) は device にしない", () => {
  const device = { present: true, hasProcessLocally: true };
  assert.equal(decideRecognitionPath({ wasmReady: false, device }).path, "self-report");
  assert.equal(decideRecognitionPath({ wasmReady: true, device }).path, "wasm");
});

test("available() が error を返したら device にしない", () => {
  const device = { present: true, hasProcessLocally: true, availability: "error" };
  assert.equal(decideRecognitionPath({ wasmReady: false, device }).path, "self-report");
});

test("どの組み合わせでも reason は空でない (画面にそのまま出す)", () => {
  const devices = [
    DEVICE_OK,
    DEVICE_DOWNLOADABLE,
    DEVICE_DOWNLOADING,
    DEVICE_UNAVAILABLE,
    SAFARI,
    NO_API,
  ];
  for (const device of devices) {
    for (const wasmReady of [true, false]) {
      for (const prefer of ["device", "wasm"]) {
        const decision = decideRecognitionPath({ wasmReady, device, prefer });
        assert.ok(decision.reason.length > 0, JSON.stringify({ device, wasmReady, prefer }));
      }
    }
  }
});
