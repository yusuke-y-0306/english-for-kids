import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { checkSessionFreshness } from "../../src/lib/auth/session-check.ts";

/**
 * セッションの即時失効 — issue #52
 *
 * 固定したい主張:
 *  1. tokenVersion を上げると、以前の cookie は **即座に** 通らない
 *  2. 端末の version を上げると、**その端末だけ** 通らない
 *  3. tokenVersion を持たない古い cookie は通さない（殺せない cookie を作らない）
 *  4. 世代を持たない古い users.json は 0 として扱う（後方互換）
 */

const DEVICE_A = "aaaaaaaaaaaaaaaa";
const DEVICE_B = "bbbbbbbbbbbbbbbb";

const user = (overrides = {}) => ({
  tokenVersion: 0,
  devices: [
    { ua: DEVICE_A, version: 0 },
    { ua: DEVICE_B, version: 0 },
  ],
  ...overrides,
});

describe("checkSessionFreshness", () => {
  test("世代が一致していれば有効", () => {
    assert.equal(checkSessionFreshness({ tv: 0 }, user()), null);
    assert.equal(checkSessionFreshness({ tv: 0, ua: DEVICE_A, dv: 0 }, user()), null);
  });

  test("tokenVersion が上がると無効 (全端末ログアウト)", () => {
    assert.equal(checkSessionFreshness({ tv: 0 }, user({ tokenVersion: 1 })), "token-version");
  });

  test("端末の version が上がるとその端末だけ無効", () => {
    const bumped = user({
      devices: [
        { ua: DEVICE_A, version: 1 },
        { ua: DEVICE_B, version: 0 },
      ],
    });
    assert.equal(checkSessionFreshness({ tv: 0, ua: DEVICE_A, dv: 0 }, bumped), "device-version");
    assert.equal(checkSessionFreshness({ tv: 0, ua: DEVICE_B, dv: 0 }, bumped), null);
  });

  test("端末の記録が無ければ通さない (覚えの無い端末)", () => {
    assert.equal(
      checkSessionFreshness({ tv: 0, ua: "cccccccccccccccc", dv: 0 }, user()),
      "unknown-device",
    );
  });

  test("tokenVersion を持たない古い cookie は通さない", () => {
    assert.equal(checkSessionFreshness({}, user()), "no-version");
    assert.equal(checkSessionFreshness({ ua: DEVICE_A, dv: 0 }, user()), "no-version");
  });

  test("古い users.json (tokenVersion 無し) は 0 として扱う", () => {
    assert.equal(checkSessionFreshness({ tv: 0 }, { devices: [] }), null);
    assert.equal(checkSessionFreshness({ tv: 1 }, { devices: [] }), "token-version");
  });

  test("端末の指紋が無いセッションは tokenVersion だけで判定する (#53 の移行パス)", () => {
    assert.equal(checkSessionFreshness({ tv: 0, dv: 0 }, user()), null);
  });
});
