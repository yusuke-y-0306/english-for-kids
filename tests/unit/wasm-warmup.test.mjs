import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { shouldWarmUpWasm } from "../../src/lib/speech/wasm-policy.ts";

/**
 * 事前読み込みの判断 — issue #2
 *
 * 固定したい主張:
 *  1. モデルが端末に無いなら**読まない** (51MB は本人の操作から)
 *  2. すでに読み込み済みなら何もしない (二重に読まない)
 *  3. 対応していない端末では何もしない
 *  4. Save-Data のときは遠慮する
 */

describe("shouldWarmUpWasm", () => {
  const READY = { supported: true, readiness: "ready", loaded: false };

  test("準備済み + 未読み込み + 対応端末なら読む", () => {
    assert.equal(shouldWarmUpWasm(READY), true);
  });

  test("モデルがまだ無いなら読まない", () => {
    assert.equal(shouldWarmUpWasm({ ...READY, readiness: "needs-download" }), false);
  });

  test("環境が対応していないなら読まない", () => {
    assert.equal(shouldWarmUpWasm({ ...READY, readiness: "unsupported" }), false);
    assert.equal(shouldWarmUpWasm({ ...READY, supported: false }), false);
  });

  test("読み込み済みなら何もしない", () => {
    assert.equal(shouldWarmUpWasm({ ...READY, loaded: true }), false);
  });

  test("Save-Data なら遠慮する", () => {
    assert.equal(shouldWarmUpWasm({ ...READY, saveData: true }), false);
  });
});
