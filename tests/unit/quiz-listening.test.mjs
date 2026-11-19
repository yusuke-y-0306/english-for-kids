import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";
import { pathToFileURL } from "node:url";

/**
 * リスニングクイズ「音をきいて絵を選ぶ」— issue #85
 *
 * ここで固定したいのは 5 つ。
 *
 *  1. `listening` がレベルの一員で、API のホワイトリスト (`isQuizLevelId`) も通る
 *  2. 出題は 8 問・4 択で、選択肢は **絵（絵文字）** を持つ
 *  3. 答えの位置が絵と文字の両方で一致する（片方だけズレない）
 *  4. 文字を読まなくても解ける = 問題文に答えの綴りを出さない
 *  5. 進捗に乗る = 全問が実在する単語 ID を持ち、音声がある
 */

// quiz.ts は拡張子なしの相対 import を持つので、解決フックを挟んでから読む
register("./ts-loader.mjs", pathToFileURL(import.meta.filename));

const { buildRound, isQuizLevelId, quizLevels, QUIZ_LENGTH } = await import(
  "../../src/lib/quiz.ts"
);
const { categories, findWordById } = await import("../../src/lib/words.ts");

/** 語 → 品詞。ダミーも含めて全部が名詞か確かめるために使う */
const POS_BY_EN = new Map(
  categories.flatMap((category) => category.words.map((word) => [word.en, word.pos])),
);

const ROUNDS = 60;

function rounds() {
  return Array.from({ length: ROUNDS }, () => buildRound("listening", QUIZ_LENGTH));
}

describe("リスニングクイズのレベル (#85)", () => {
  test("quizLevels に listening があり、ID が重複しない", () => {
    const ids = quizLevels.map((level) => level.id);
    assert.ok(ids.includes("listening"), "listening がレベルに無い");
    assert.equal(new Set(ids).size, ids.length, "レベルの ID が重複している");
  });

  test("API のホワイトリスト (isQuizLevelId) を通る", () => {
    assert.equal(isQuizLevelId("listening"), true);
    assert.equal(isQuizLevelId("expert"), false);
  });

  test("すべてのレベルで 1 ラウンドを組み立てられる", () => {
    for (const level of quizLevels) {
      const round = buildRound(level.id, QUIZ_LENGTH);
      assert.equal(round.length, QUIZ_LENGTH, `${level.id} の問題数`);
      for (const question of round) {
        assert.ok(
          Number.isInteger(question.answer) &&
            question.answer >= 0 &&
            question.answer < question.choices.length,
          `${level.id}: answer が index になっていない`,
        );
      }
    }
  });
});

describe("リスニングクイズの出題 (#85)", () => {
  test("8 問・4 択で、選択肢はすべて絵を持つ", () => {
    for (const round of rounds()) {
      assert.equal(round.length, QUIZ_LENGTH);

      for (const question of round) {
        assert.ok(question.wordId, "単語 ID が無い（進捗に乗らない）");
        assert.equal(question.choices.length, 4, "選択肢は 4 つ");
        assert.ok(Array.isArray(question.pictures), "絵の選択肢が無い");
        assert.equal(question.pictures.length, 4, "絵は 4 つ");
        for (const picture of question.pictures) {
          assert.ok(
            typeof picture === "string" && picture.length > 0,
            "空の絵がある",
          );
        }
      }
    }
  });

  test("絵も文字も重複しない（正解が 2 つに見えない）", () => {
    for (const round of rounds()) {
      for (const question of round) {
        assert.equal(
          new Set(question.choices).size,
          4,
          `選択肢の語が重複: ${question.choices.join(", ")}`,
        );
        assert.equal(
          new Set(question.pictures).size,
          4,
          `選択肢の絵が重複: ${question.pictures.join(" ")}`,
        );
      }
    }
  });

  test("答えの位置が絵と文字で一致し、実在する単語を指す", () => {
    for (const round of rounds()) {
      for (const question of round) {
        const answerWord = question.choices[question.answer];
        const found = findWordById(question.wordId);
        assert.ok(found, `wordId が語彙に無い: ${question.wordId}`);
        assert.equal(found.word.en, answerWord, "wordId と正解の語がズレている");
        assert.equal(
          question.pictures[question.answer],
          found.word.emoji,
          "正解の絵が単語の絵と違う",
        );
      }
    }
  });

  test("文字を読まなくても解ける（問題文に正解の綴りを出さない）", () => {
    for (const round of rounds()) {
      for (const question of round) {
        assert.equal(question.promptEn, undefined, "英語の問題文を出している");
        assert.equal(question.display, undefined, "答えの絵を問題文に出している");
        const answer = question.choices[question.answer];
        assert.ok(
          !question.promptJa.toLowerCase().includes(answer.toLowerCase()),
          `問題文に正解が書いてある: ${question.promptJa}`,
        );
      }
    }
  });

  test("具体名詞だけを使う（前置詞・形容詞・動詞は絵で決まらない）", () => {
    for (const round of rounds()) {
      for (const question of round) {
        const found = findWordById(question.wordId);
        assert.equal(found.word.pos, "noun", `名詞でない: ${found.word.id}`);

        for (const choice of question.choices) {
          assert.equal(POS_BY_EN.get(choice), "noun", `名詞でない選択肢: ${choice}`);
        }
      }
    }
  });

  test("正解の位置が A に固定されない", () => {
    const counts = [0, 0, 0, 0];
    for (const round of rounds()) {
      for (const question of round) counts[question.answer] += 1;
    }
    for (const [index, count] of counts.entries()) {
      assert.ok(count > 0, `正解が位置 ${index} に一度も来ない (${counts.join("/")})`);
    }
  });

  test("同じラウンド内で同じ単語を 2 回出さない", () => {
    for (const round of rounds()) {
      const ids = round.map((question) => question.wordId);
      assert.equal(new Set(ids).size, ids.length, `重複出題: ${ids.join(", ")}`);
    }
  });

  test("全問に音声がある（音だけで 1 ラウンド完走できる前提）", () => {
    for (const round of rounds()) {
      for (const question of round) {
        const found = findWordById(question.wordId);
        assert.ok(
          typeof found.word.audio === "string" && found.word.audio.length > 0,
          `音声が無い: ${found.word.id}`,
        );
      }
    }
  });
});
