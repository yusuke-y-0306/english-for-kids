import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test, { describe } from "node:test";
import { pathToFileURL } from "node:url";

/**
 * 中級・上級クイズの正解位置 — issue #82
 *
 * 問題プールは 24 問すべてが `answer: 0` で、正解は「選択肢の一番上」という
 * 並び順に依存していた。出題時に choices を並べ替えてはいたものの、データ
 * 側が index で正解を持つ限り、選択肢を書き換えた瞬間に採点が壊れる。
 *
 * そこで正解を **文字列** で持つ形に変えた (#82)。ここでは
 *  1. シャッフル後も採点対象が意図した正解文字列と一致する
 *  2. 同じ問題を繰り返しても正解位置が A に固定されない
 *  3. プールのデータが index に戻っていない（ソース上の柵）
 * を固定する。
 */

// quiz.ts は拡張子なしの相対 import を持つので、解決フックを挟んでから読む
register("./quiz-loader.mjs", pathToFileURL(import.meta.filename));

const { buildRound, QUIZ_LENGTH } = await import("../../src/lib/quiz.ts");

const POOL_LEVELS = ["intermediate", "advanced"];
/** 正解位置の偏りを見るための試行回数（1 ラウンド 8 問 × 60 = 480 問） */
const ROUNDS = 60;

function roundsOf(level) {
  return Array.from({ length: ROUNDS }, () => buildRound(level, QUIZ_LENGTH));
}

describe("中級・上級クイズの正解位置 (#82)", () => {
  for (const level of POOL_LEVELS) {
    describe(level, () => {
      test("シャッフル後も採点される答えは問題ごとに 1 つに定まる", () => {
        /** promptEn → 採点対象になった文字列の集合 */
        const graded = new Map();

        for (const round of roundsOf(level)) {
          for (const q of round) {
            assert.equal(q.choices.length, 4, "選択肢は 4 つ");
            assert.equal(
              new Set(q.choices).size,
              q.choices.length,
              `「${q.promptEn}」の選択肢が重複している`,
            );
            assert.ok(
              Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4,
              `「${q.promptEn}」の answer が index になっていない: ${q.answer}`,
            );

            const picked = q.choices[q.answer];
            if (!graded.has(q.promptEn)) graded.set(q.promptEn, new Set());
            graded.get(q.promptEn).add(picked);
          }
        }

        assert.ok(graded.size >= 6, `出題された問題が少なすぎる: ${graded.size}`);
        for (const [prompt, picked] of graded) {
          assert.equal(
            picked.size,
            1,
            `「${prompt}」の採点対象が回によって変わっている: ${[...picked].join(" / ")}`,
          );
        }
      });

      test("同じ問題を繰り返し出題しても正解の位置が偏らない", () => {
        const positions = new Map();

        for (const round of roundsOf(level)) {
          for (const q of round) {
            if (!positions.has(q.promptEn)) positions.set(q.promptEn, new Set());
            positions.get(q.promptEn).add(q.answer);
          }
        }

        for (const [prompt, seen] of positions) {
          assert.ok(
            seen.size >= 2,
            `「${prompt}」の正解位置が固定されている: ${[...seen].join(",")}`,
          );
        }
        assert.ok(positions.size >= 6);
      });
    });
  }

  test("プールの正解は index ではなく文字列で持つ（データ側の回帰）", async () => {
    const source = await readFile("src/lib/quiz.ts", "utf8");
    const fromPools = source.slice(source.indexOf("const intermediatePool"));
    // コメント中の `answer: 0` の説明文と区別するため、コメントを落としてから見る
    const pools = fromPools
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // 元のバグ（24 問すべて answer: 0）が戻っていないこと
    assert.doesNotMatch(
      pools,
      /answer:\s*\d/,
      "プールが正解を index で持っている（並び順に依存する）",
    );
    const stringAnswers = pools.match(/answer:\s*"/g) ?? [];
    assert.ok(
      stringAnswers.length >= 24,
      `プールの正解は文字列で持つ（見つかった数: ${stringAnswers.length}）`,
    );
    assert.match(source, /type QuizPoolEntry = Omit<QuizQuestion, "id" \| "answer">/);
  });

  test("初級はこれまでどおり wordId 付きで出題される", () => {
    const round = buildRound("beginner", QUIZ_LENGTH);
    assert.equal(round.length, QUIZ_LENGTH);
    for (const q of round) {
      assert.ok(q.wordId, "進捗記録 (#76) 用の wordId が付く");
      assert.ok(q.display, "絵文字が付く");
      assert.ok(q.answer >= 0 && q.answer < q.choices.length);
      assert.equal(typeof q.choices[q.answer], "string", "採点対象は選択肢の文字列");
    }
  });
});
