import assert from "node:assert/strict";
import test from "node:test";

import {
  levenshtein,
  normalizeTranscript,
  scorePronunciation,
} from "../../src/lib/speech/scoring.ts";

/**
 * 発音判定の仕様を固定する — issue #2
 *
 * 判定は端末内の純粋関数なので、ブラウザなしで検証できる。
 * 「子どもを厳しく減点しない」という方針がそのままテストになっている。
 */

test("normalizeTranscript: 記号・大文字・余分な空白を落とす", () => {
  assert.equal(normalizeTranscript("  Dog!  "), "dog");
  assert.equal(normalizeTranscript("A   dog."), "a dog");
  assert.equal(normalizeTranscript("ＤＯＧ"), "dog"); // 全角も NFKC で吸収
  assert.equal(normalizeTranscript("🐶"), "");
});

test("levenshtein: 基本ケース", () => {
  assert.equal(levenshtein("dog", "dog"), 0);
  assert.equal(levenshtein("dog", "dig"), 1);
  assert.equal(levenshtein("dog", "dogs"), 1);
  assert.equal(levenshtein("", "cat"), 3);
});

test("完全一致は ok", () => {
  const r = scorePronunciation("dog", "dog");
  assert.equal(r.score, "ok");
  assert.equal(r.distance, 0);
});

test("大文字・句読点・余分な語を許す", () => {
  assert.equal(scorePronunciation("Dog!", "dog").score, "ok");
  assert.equal(scorePronunciation("a dog", "dog").score, "ok");
  assert.equal(scorePronunciation("it's a dog", "dog").score, "ok");
});

test("1 文字違いは close (子どもを減点しすぎない)", () => {
  assert.equal(scorePronunciation("dig", "dog").score, "close");
  assert.equal(scorePronunciation("caat", "cat").score, "close");
});

test("似ていない語は retry", () => {
  assert.equal(scorePronunciation("elephant", "dog").score, "retry");
  assert.equal(scorePronunciation("zzz", "elephant").score, "retry");
});

test("聞き取れなかった (空文字) は retry", () => {
  const r = scorePronunciation("   ", "dog");
  assert.equal(r.score, "retry");
  assert.match(r.hint, /きこえ/);
});

test("お手本が空なら retry (呼び出し側のバグを握り潰さない)", () => {
  assert.equal(scorePronunciation("dog", "").score, "retry");
});

test("複数語のお手本でも窓で一致を見る", () => {
  assert.equal(scorePronunciation("i see a big red bus", "red bus").score, "ok");
  assert.equal(scorePronunciation("red box", "red bus").score, "close");
});

test("score は 3 値のいずれか", () => {
  for (const said of ["dog", "dig", "zzz", ""]) {
    assert.ok(["ok", "close", "retry"].includes(scorePronunciation(said, "dog").score));
  }
});
