import assert from "node:assert/strict";
import test from "node:test";

import { normalizePassphrase } from "../../src/lib/auth/passphrase.ts";

/**
 * パスフレーズの入力ゆれ吸収 — 家庭の iPhone で「正しいのに ちがうと言われる」
 * を防ぐ。保存時と照合時で同じ関数を通す前提なので、ここは純粋関数で固定する。
 */

test("normalizePassphrase: 前後の空白・改行を落とす", () => {
  assert.equal(normalizePassphrase("  eigo-kids-2026  "), "eigo-kids-2026");
  assert.equal(normalizePassphrase("\neigo-kids-2026\r\n"), "eigo-kids-2026");
  assert.equal(normalizePassphrase("\teigo-kids-2026 "), "eigo-kids-2026");
});

test("normalizePassphrase: 全角英数を半角に寄せる (日本語 IME 対策)", () => {
  assert.equal(normalizePassphrase("ｅｉｇｏ－ｋｉｄｓ"), "eigo-kids");
  assert.equal(normalizePassphrase("ＥＩＧＯ2026"), "EIGO2026");
});

test("normalizePassphrase: 不可視文字を落とす (コピペ対策)", () => {
  assert.equal(normalizePassphrase("eigo\u200Bkids"), "eigokids");
  assert.equal(normalizePassphrase("\uFEFFeigo-kids"), "eigo-kids");
  assert.equal(normalizePassphrase("eigo\u00ADkids"), "eigokids");
});

test("normalizePassphrase: スマート句読点のダッシュを ASCII ハイフンに寄せる", () => {
  assert.equal(normalizePassphrase("eigo–kids"), "eigo-kids");
  assert.equal(normalizePassphrase("eigo—kids"), "eigo-kids");
  assert.equal(normalizePassphrase("eigo−kids"), "eigo-kids");
});

test("normalizePassphrase: 内側の空白は潰さない", () => {
  assert.equal(normalizePassphrase("eigo kids 2026"), "eigo kids 2026");
  assert.equal(normalizePassphrase("  eigo  kids  "), "eigo  kids");
});

test("normalizePassphrase: 空文字・空白のみは空になる", () => {
  assert.equal(normalizePassphrase(""), "");
  assert.equal(normalizePassphrase("   \n\t"), "");
});
