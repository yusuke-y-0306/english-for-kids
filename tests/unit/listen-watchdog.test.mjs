import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { LISTEN_WATCHDOG_MS, isListenStuck } from "../../src/lib/speech/listen-watchdog.ts";

/**
 * 「きいてるよ…」の番人 — issue #2
 *
 * 固定したい主張:
 *  1. 上限ちょうどで発火する (境界がぶれない)
 *  2. まだなら黙っている (子どもが話している最中に邪魔しない)
 *  3. 時計が巻き戻っても発火しない (負の経過で誤爆しない)
 */

describe("isListenStuck", () => {
  test("上限に達したら true", () => {
    const startedAt = 1_000;
    assert.equal(isListenStuck(startedAt, startedAt + LISTEN_WATCHDOG_MS), true);
    assert.equal(isListenStuck(startedAt, startedAt + LISTEN_WATCHDOG_MS + 1), true);
  });

  test("上限未満なら false", () => {
    const startedAt = 1_000;
    assert.equal(isListenStuck(startedAt, startedAt + LISTEN_WATCHDOG_MS - 1), false);
    assert.equal(isListenStuck(startedAt, startedAt), false);
  });

  test("時計が巻き戻っても false", () => {
    assert.equal(isListenStuck(10_000, 9_000), false);
  });

  test("数値でない時刻は判定しない", () => {
    assert.equal(isListenStuck(Number.NaN, 10_000), false);
    assert.equal(isListenStuck(0, Number.POSITIVE_INFINITY), false);
  });

  test("上限は 30 秒 (子どもの待ち時間としてここを超えたら戻す)", () => {
    assert.equal(LISTEN_WATCHDOG_MS, 30_000);
  });
});
