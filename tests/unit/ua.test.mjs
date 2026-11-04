import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { bindingOf, compareBinding, uaClassOf, uaHashOf } from "../../src/lib/auth/ua.ts";

/**
 * セッション cookie と端末 (User-Agent) の紐付け — issue #53
 *
 * ここで固定したい主張は 2 つ:
 *
 *  1. **別の端末にコピーされた cookie は通らない**（種類が変われば mismatch）
 *  2. **ブラウザ更新で子どもを締め出さない**（同じ種類なら drift = 通して再発行）
 *
 * 2 を忘れると「Safari が更新された日に家族全員ログアウト」になる。
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const IPHONE_UPDATED =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("uaClassOf", () => {
  test("代表的な UA を種類に落とす", () => {
    assert.equal(uaClassOf(IPHONE), "iphone");
    assert.equal(uaClassOf(IPAD), "ipad");
    assert.equal(uaClassOf(ANDROID), "android");
    assert.equal(uaClassOf(MAC), "mac");
    assert.equal(uaClassOf(WINDOWS), "windows");
    assert.equal(uaClassOf("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"), "linux");
  });

  test("iPhone の UA は 'like Mac OS X' を含むが iphone", () => {
    assert.ok(IPHONE.includes("Mac OS X"));
    assert.equal(uaClassOf(IPHONE), "iphone");
  });

  test("Android の UA は 'Linux' を含むが android", () => {
    assert.ok(ANDROID.includes("Linux"));
    assert.equal(uaClassOf(ANDROID), "android");
  });

  test("Chromebook は other (Linux と混同しない)", () => {
    assert.equal(uaClassOf("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36"), "other");
  });

  test("アプリ内ブラウザでも端末の種類は保たれる", () => {
    assert.equal(uaClassOf(`${IPHONE} Line/13.1.0`), "iphone");
  });

  test("空 / 未設定は other", () => {
    assert.equal(uaClassOf(""), "other");
    assert.equal(uaClassOf(null), "other");
    assert.equal(uaClassOf(undefined), "other");
  });
});

describe("uaHashOf", () => {
  test("同じ UA なら同じ指紋 (16 文字)", () => {
    const a = uaHashOf(IPHONE);
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(a, uaHashOf(IPHONE));
  });

  test("違う UA なら違う指紋", () => {
    assert.notEqual(uaHashOf(IPHONE), uaHashOf(IPHONE_UPDATED));
    assert.notEqual(uaHashOf(IPHONE), uaHashOf(ANDROID));
  });

  test("生の UA をそのまま含まない", () => {
    assert.ok(!uaHashOf(IPHONE).includes("iphone"));
  });
});

describe("compareBinding", () => {
  const stored = bindingOf(IPHONE); // { ua, uc } — cookie に入る形そのもの

  test("同じ端末は ok", () => {
    assert.equal(compareBinding(stored, bindingOf(IPHONE), false), "ok");
  });

  test("ua を持たない古い cookie は legacy (通す)", () => {
    assert.equal(compareBinding({}, bindingOf(IPHONE), false), "legacy");
    assert.equal(compareBinding(undefined, bindingOf(IPHONE), false), "legacy");
  });

  test("同じ種類でブラウザ更新 → drift (通して再発行)", () => {
    assert.equal(compareBinding(stored, bindingOf(IPHONE_UPDATED), false), "drift");
  });

  test("種類が変わったら mismatch (コピーされた cookie)", () => {
    assert.equal(compareBinding(stored, bindingOf(ANDROID), false), "mismatch");
    assert.equal(compareBinding(stored, bindingOf(MAC), false), "mismatch");
  });

  test("strict ならハッシュの違いも mismatch", () => {
    assert.equal(compareBinding(stored, bindingOf(IPHONE_UPDATED), true), "mismatch");
  });

  test("種類が保存されていない古い cookie でも判定できる", () => {
    // uc が無い場合はハッシュだけで判断する (非 strict なら drift)
    assert.equal(compareBinding({ ua: stored.ua }, bindingOf(ANDROID), false), "drift");
    assert.equal(compareBinding({ ua: stored.ua }, bindingOf(ANDROID), true), "mismatch");
  });
});
