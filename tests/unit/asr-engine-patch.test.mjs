import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { applyPatch, patchEngine, patchThreadPool } from "../../scripts/asr-engine.mjs";

/**
 * エンジン配布時のパッチ — issue #2
 *
 * 固定したい主張:
 *  1. pthread プールを 2 に絞る (iPhone で 6 コア分の wasm コンパイルが走るのを避ける)
 *  2. Worker へ `wasmModule` を渡せない環境でも、**渡さずに送り直す**
 *     (Safari が構造化クローンに失敗すると、Emscripten は永久に待ち続ける)
 *  3. 何度かけても同じ結果 (ビルドのたびに走るので必須)
 *  4. 上流の生成物が変わって置換できなくなったら**黙って通さない**
 */

/** パッチ対象 2 箇所を含む最小の生成物 */
const SOURCE =
  "var x=1;var pthreadPoolSize=navigator.hardwareConcurrency;while(pthreadPoolSize--){}" +
  'var y=2;worker.postMessage({cmd:"load",handlers,wasmMemory,wasmModule})';

describe("patchThreadPool", () => {
  test("プールを 2 に制限する", () => {
    const patched = patchThreadPool(SOURCE);
    assert.match(patched, /var pthreadPoolSize=Math\.min\(navigator\.hardwareConcurrency,2\);/);
    assert.doesNotMatch(patched, /pthreadPoolSize=navigator\.hardwareConcurrency/);
  });

  test("二度かけても同じ (冪等)", () => {
    const once = patchThreadPool(SOURCE);
    assert.equal(patchThreadPool(once), once);
  });
});

describe("patchEngine (wasmModule を渡せない環境向け)", () => {
  test("postMessage を try/catch で包み、失敗したら渡さずに送り直す", () => {
    const patched = patchEngine(SOURCE);
    assert.match(patched, /try\{worker\.postMessage\(\{cmd:"load",handlers,wasmMemory,wasmModule\}\)\}/);
    assert.match(patched, /catch\(_e\)\{/);
    assert.match(patched, /worker\.postMessage\(\{cmd:"load",handlers,wasmMemory\}\)\}/);
    /* 元のシグネチャは残す (wasmModule を渡せる環境では今までどおり) */
    assert.ok(patched.includes("wasmModule})"));
    /* 周りは壊さない */
    assert.ok(patched.startsWith("var x=1;"));
    assert.ok(patched.includes("var y=2;"));
  });

  test("両方のパッチが当たる", () => {
    const patched = patchEngine(SOURCE);
    assert.ok(patched.includes("Math.min(navigator.hardwareConcurrency,2)"));
    assert.ok(patched.includes("Worker に渡せませんでした"));
  });

  test("二度かけても同じ (冪等)", () => {
    const once = patchEngine(SOURCE);
    assert.equal(patchEngine(once), once);
  });

  test("置換対象が無ければ例外 (上流の変更に気づける)", () => {
    assert.throws(() => patchEngine("var nothing=1;"), /置換対象が見つかりません/);
    assert.throws(
      () => applyPatch("var nothing=1;", { file: "moonshine.mjs", from: "not-there", to: "x" }),
      /置換対象が見つかりません/,
    );
  });
});
