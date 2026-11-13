import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * 中級・上級クイズの正解位置 — issue #82
 *
 * 問題プールは以前 `answer: 0`（＝正解が常に選択肢 A の書き順）で保持され、
 * 「一番上を選べば当たる」学習が成立してしまった。出題時に選択肢を
 * シャッフルして正解位置を再計算するようになってからはランタイムの
 * 判定は正しいが、データ側は「正解が choices[0] にある」という暗黙の
 * 約束に依存し続けている。そこで：
 *
 * 1. プールは正解を **文字列** で保持する（index に寄せない）
 * 2. シャッフル後も `choices[answer]` が意図した正解と一致すること
 * 3. 同一問題を繰り返し出題しても正解位置が偏らないこと
 * をテストで担保する。
 */

register("./quiz-loader.mjs", pathToFileURL(import.meta.filename));

const { buildRound, QUIZ_LENGTH } = await import("../../src/lib/quiz.ts");

// プール側のデータと目が合うよう、正解をここにも書いておく（#82 の検証用）
const EXPECTED = {
  intermediate: {
    "I ___ a dog.": "have",
    "She ___ a teacher.": "is",
    "___ you like apples?": "Do",
    "This is ___ orange.": "an",
    "There ___ two cats.": "are",
    "I can ___ fast.": "run",
    "He ___ to school every day.": "goes",
    "___ is your name?": "What",
    "I have two ___.": "boxes",
    "Look! It ___ raining.": "is",
    "I like cats, ___ I don't like dogs.": "but",
    "How many ___ do you have?": "pens",
  },
  advanced: {
    "ただしい ぶんは どれ？": "She doesn't like carrots.",
    "I have lived here ___ 2019.": "since",
    "If it ___ tomorrow, we'll stay home.": "rains",
    "This book is ___ than that one.": "more interesting",
    "He asked me ___ I was hungry.": "if",
    "There are ___ apples than bananas.": "fewer",
    "I'm looking forward to ___ you.": "seeing",
    "The cake ___ by my mother yesterday.": "was made",
    "She is the ___ girl in our class.": "tallest",
    "___ hard, and you will succeed.": "Work",
    "This is the restaurant ___ we ate last night.": "where",
    "Neither Tom ___ his friends were there.": "nor",
  },
};

const SAMPLES = 60;

describe("中級・上級クイズの正解位置 (#82)", () => {
  for (const level of ["intermediate", "advanced"]) {
    describe(level, () => {
      const expected = EXPECTED[level];

      test("シャッフル後も choices[answer] が正解文字列と一致する", () => {
        const seen = new Set();
        for (let i = 0; i < SAMPLES; i++) {
          for (const q of buildRound(level, QUIZ_LENGTH)) {
            seen.add(q.promptEn);
            assert.ok(q.answer >= 0 && q.answer < q.choices.length);
            const want = expected[q.promptEn];
            if (want !== undefined) {
              assert.equal(
                q.choices[q.answer],
                want,
                `「${q.promptEn}」の正解がずれている`,
              );
            }
          }
        }
        // プール 12 問のうち、出題サンプルで期待どおりの問題が出てくる
        assert.ok(seen.size >= 6, `出題数が少なすぎる: ${seen.size}`);
      });

      test("同一問題を繰り返し出題しても正解位置が偏らない", () => {
        const positions = new Map();
        for (let i = 0; i < SAMPLES; i++) {
          for (const q of buildRound(level, QUIZ_LENGTH)) {
            if (expected[q.promptEn] === undefined) continue;
            if (!positions.has(q.promptEn)) positions.set(q.promptEn, new Set());
            positions.get(q.promptEn).add(q.answer);
          }
        }
        // どの問題も正解位置が 2 箇所以上に散っている（常に A になっていない）
        for (const [prompt, set] of positions) {
          assert.ok(
            set.size >= 2,
            `「${prompt}」の正解位置が固定されている: ${[...set].join(",")}`,
          );
        }
        assert.ok(positions.size >= 6);
      });
    });
  }

  test("初級はこれまでどおり wordId 付きで出題される", () => {
    const round = buildRound("beginner", QUIZ_LENGTH);
    assert.equal(round.length, QUIZ_LENGTH);
    for (const q of round) {
      assert.ok(q.wordId, "wordId がある");
      assert.ok(q.answer >= 0 && q.answer < q.choices.length);
    }
  });
});
