import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { patchThreadPool } from "../../scripts/asr-engine.mjs";

/**
 * エンジン配布時の pthread プール上限 — issue #2
 *
 * 固定したい主張:
 *  1. 生成物の `navigator.hardwareConcurrency` を 2 に絞る (iPhone で 6 コア分の
 *     wasm コンパイルが走り、読み込みが終わらなくなるため)
 *  2. 何度かけても同じ結果 (冪等)。ビルドのたびに走るので必須
 *  3. 上流の生成物が変わって置換できなくなったら**黙って通さない**
 */

const SOURCE = "var x=1;var pthreadPoolSize=navigator.hardwareConcurrency;while(pthreadPoolSize--){}";

describe("patchThreadPool", () => {
  test("プールを 2 に制限する", () => {
    const patched = patchThreadPool(SOURCE);
    assert.match(patched, /var pthreadPoolSize=Math\.min\(navigator\.hardwareConcurrency,2\);/);
    assert.doesNotMatch(patched, /pthreadPoolSize=navigator\.hardwareConcurrency/);
  });

  test("他の部分は変えない", () => {
    const patched = patchThreadPool(SOURCE);
    assert.ok(patched.startsWith("var x=1;"));
    assert.ok(patched.endsWith("while(pthreadPoolSize--){}"));
  });

  test("二度かけても同じ (冪等)", () => {
    const once = patchThreadPool(SOURCE);
    assert.equal(patchThreadPool(once), once);
  });

  test("置換対象が無ければ例外 (上流の変更に気づける)", () => {
    assert.throws(() => patchThreadPool("var nothing=1;"), /pthread プール設定が見つかりません/);
  });
});
