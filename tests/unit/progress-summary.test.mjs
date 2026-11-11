import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { addDays } from "../../src/lib/progress/day.ts";
import {
  DAILY_SERIES_DEFAULT_DAYS,
  DAILY_SERIES_MAX_DAYS,
  MASTERY_THRESHOLDS,
  clampDayCount,
  masteryOf,
  summarizeCategories,
  summarizeDaily,
  summarizeWords,
} from "../../src/lib/progress/summary.ts";
import { allWordIds, categories } from "../../src/lib/words.ts";

/**
 * 進捗の集計 — issue #67
 *
 * 固定したい主張:
 *  1. 0 件 (新規ユーザー) でも例外にならず、0 で埋まった系列を返す
 *  2. 歯抜けの日は 0 として埋まる (グラフの棒がずれない)
 *  3. 月跨ぎ・年跨ぎ・閏年で日付が壊れない
 *  4. `?days=` は 1〜90 にクランプされ、不正値は既定に落ちる
 *  5. 単語の習得度・カテゴリの達成度が「未 / 練習中 / 覚えた」で数えられる
 */

const TODAY = "2026-11-09";

const quizDay = (rounds, correct, total) => ({
  quiz: { rounds, correct, total },
  pronunciation: { attempts: 0, ok: 0 },
});

const pronunciationDay = (attempts, ok) => ({
  quiz: { rounds: 0, correct: 0, total: 0 },
  pronunciation: { attempts, ok },
});

const cardDay = (views) => ({
  quiz: { rounds: 0, correct: 0, total: 0 },
  pronunciation: { attempts: 0, ok: 0 },
  cards: { views },
});

const inputOf = ({ days = {}, words = {}, cards = {}, pronunciation = {} } = {}) => ({
  days,
  words,
  cards,
  pronunciation,
});

describe("clampDayCount", () => {
  test("未指定・空・不正値は既定 (7)", () => {
    for (const raw of [undefined, null, "", "abc", "7days", {}]) {
      assert.equal(clampDayCount(raw), DAILY_SERIES_DEFAULT_DAYS);
    }
  });

  test("1〜90 に丸める", () => {
    assert.equal(clampDayCount("1"), 1);
    assert.equal(clampDayCount("7"), 7);
    assert.equal(clampDayCount("90"), 90);
    assert.equal(clampDayCount("91"), DAILY_SERIES_MAX_DAYS);
    assert.equal(clampDayCount("1000"), DAILY_SERIES_MAX_DAYS);
    assert.equal(clampDayCount("0"), 1);
    assert.equal(clampDayCount("-5"), 1);
    assert.equal(clampDayCount("7.9"), 7);
    assert.equal(clampDayCount(30), 30);
  });
});

describe("summarizeDaily", () => {
  test("0 件でも例外にならず、0 で埋まった 7 日を返す", () => {
    const series = summarizeDaily(inputOf(), { today: TODAY });
    assert.equal(series.length, DAILY_SERIES_DEFAULT_DAYS);
    assert.equal(series[series.length - 1].day, TODAY);
    for (const slice of series) {
      assert.deepEqual(slice.quiz, { rounds: 0, correct: 0, total: 0, accuracy: 0 });
      assert.deepEqual(slice.pronunciation, { attempts: 0, ok: 0 });
      assert.deepEqual(slice.cards, { views: 0 });
      assert.equal(slice.studied, false);
    }
  });

  test("古い順に並び、最後が today", () => {
    const series = summarizeDaily(inputOf(), { days: 3, today: TODAY });
    assert.deepEqual(
      series.map((s) => s.day),
      ["2026-11-07", "2026-11-08", TODAY],
    );
  });

  test("歯抜けの日は 0 で埋まる", () => {
    const series = summarizeDaily(
      inputOf({ days: { [TODAY]: quizDay(2, 5, 8), "2026-11-07": pronunciationDay(2, 1) } }),
      { days: 3, today: TODAY },
    );
    assert.deepEqual(
      series.map((s) => s.studied),
      [true, false, true],
    );
    assert.deepEqual(series[0].day, "2026-11-07");
    assert.deepEqual(series[0].pronunciation, { attempts: 2, ok: 1 });
    assert.deepEqual(series[1].quiz, { rounds: 0, correct: 0, total: 0, accuracy: 0 });
  });

  test("カードだけの日も「学習した日」になる", () => {
    const series = summarizeDaily(inputOf({ days: { [TODAY]: cardDay(3) } }), {
      days: 1,
      today: TODAY,
    });
    assert.deepEqual(series[0].cards, { views: 3 });
    assert.equal(series[0].studied, true);
  });

  test("クイズは 8 問終える前でも「学習した日」になる (#76)", () => {
    const series = summarizeDaily(
      inputOf({ days: { [TODAY]: { quiz: { rounds: 0, correct: 0, total: 1 } } } }),
      { days: 1, today: TODAY },
    );
    assert.deepEqual(series[0].quiz, { rounds: 0, correct: 0, total: 1, accuracy: 0 });
    assert.equal(series[0].studied, true);
  });

  test("正答率は 0〜100 の整数 %", () => {
    const series = summarizeDaily(inputOf({ days: { [TODAY]: quizDay(1, 2, 3) } }), {
      days: 1,
      today: TODAY,
    });
    assert.equal(series[0].quiz.accuracy, 67);
    assert.equal(series[0].quiz.correct, 2);
    assert.equal(series[0].quiz.total, 3);
  });

  test("月跨ぎで日付が壊れない", () => {
    const series = summarizeDaily(inputOf(), { days: 5, today: "2026-11-02" });
    assert.deepEqual(
      series.map((s) => s.day),
      ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"],
    );
  });

  test("年跨ぎで日付が壊れない", () => {
    const series = summarizeDaily(inputOf(), { days: 4, today: "2027-01-02" });
    assert.deepEqual(
      series.map((s) => s.day),
      ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
    );
  });

  test("閏日を跨げる", () => {
    const series = summarizeDaily(inputOf(), { days: 3, today: "2028-03-01" });
    assert.deepEqual(
      series.map((s) => s.day),
      ["2028-02-28", "2028-02-29", "2028-03-01"],
    );
  });

  test("days は上限でクランプされる", () => {
    const series = summarizeDaily(inputOf(), { days: 1000, today: TODAY });
    assert.equal(series.length, DAILY_SERIES_MAX_DAYS);
    assert.equal(series[series.length - 1].day, TODAY);
    assert.equal(series[0].day, addDays(TODAY, -(DAILY_SERIES_MAX_DAYS - 1)));
  });

  test("壊れた日次データでも落ちない (負・小数・型違い)", () => {
    const series = summarizeDaily(
      inputOf({
        days: {
          [TODAY]: { quiz: { rounds: -1, correct: 9, total: 2 }, pronunciation: { attempts: "x", ok: 5 } },
          "2026-11-08": null,
        },
      }),
      { days: 2, today: TODAY },
    );
    assert.deepEqual(series[1].quiz, { rounds: 0, correct: 2, total: 2, accuracy: 100 });
    assert.deepEqual(series[1].pronunciation, { attempts: 0, ok: 0 });
    assert.equal(series[0].studied, false);
  });

  test("today が壊れていたら空を返す", () => {
    assert.deepEqual(summarizeDaily(inputOf(), { days: 7, today: "not-a-day" }), []);
  });
});

describe("masteryOf / summarizeWords", () => {
  test("記録が無ければ「まだ」", () => {
    const mastery = masteryOf("animals/dog", inputOf());
    assert.equal(mastery.level, "unseen");
    assert.deepEqual(mastery.pronunciation, { attempts: 0, ok: false });
    assert.equal(mastery.lastAt, null);
  });

  test(`クイズ ${MASTERY_THRESHOLDS.correctForMastered} 回正解で「覚えた」`, () => {
    const input = inputOf({ words: { "animals/dog": { correct: 3, wrong: 1, lastAt: "2026-11-08T00:00:00.000Z" } } });
    assert.equal(masteryOf("animals/dog", input).level, "mastered");
  });

  test("クイズ 1 回正解 + 発音 ok でも「覚えた」", () => {
    const input = inputOf({
      words: { "food/apple": { correct: 1, wrong: 0 } },
      pronunciation: { "food/apple": { score: "ok", attempts: 2 } },
    });
    const mastery = masteryOf("food/apple", input);
    assert.equal(mastery.level, "mastered");
    assert.deepEqual(mastery.pronunciation, { attempts: 2, ok: true });
  });

  test("カードで見ただけなら「練習中」(おぼえた にはしない)", () => {
    const input = inputOf({ cards: { "animals/fish": { views: 2, lastAt: "2026-11-08T00:00:00.000Z" } } });
    const mastery = masteryOf("animals/fish", input);
    assert.equal(mastery.level, "learning");
    assert.equal(mastery.cards, 2);
    assert.equal(mastery.correct, 0);
  });

  test("lastAt はカードも含めて一番新しいもの", () => {
    const input = inputOf({
      words: { "animals/bear": { correct: 1, wrong: 0, lastAt: "2026-11-01T00:00:00.000Z" } },
      cards: { "animals/bear": { views: 1, lastAt: "2026-11-07T00:00:00.000Z" } },
      pronunciation: { "animals/bear": { score: "ok", attempts: 1, updatedAt: "2026-11-05T00:00:00.000Z" } },
    });
    assert.equal(masteryOf("animals/bear", input).lastAt, "2026-11-07T00:00:00.000Z");
  });

  test("不正解だけ・発音だけなら「練習中」", () => {
    assert.equal(masteryOf("animals/cat", inputOf({ words: { "animals/cat": { correct: 0, wrong: 2 } } })).level, "learning");
    assert.equal(
      masteryOf("food/milk", inputOf({ pronunciation: { "food/milk": { score: "close", attempts: 1 } } })).level,
      "learning",
    );
  });

  test("発音のスコアが retry なら「覚えた」にしない", () => {
    const input = inputOf({
      words: { "food/rice": { correct: 1, wrong: 0 } },
      pronunciation: { "food/rice": { score: "retry", attempts: 3 } },
    });
    assert.equal(masteryOf("food/rice", input).level, "learning");
  });

  test("lastAt はクイズと発音の新しい方", () => {
    const input = inputOf({
      words: { "animals/bird": { correct: 1, wrong: 0, lastAt: "2026-11-01T00:00:00.000Z" } },
      pronunciation: { "animals/bird": { score: "ok", attempts: 1, updatedAt: "2026-11-05T00:00:00.000Z" } },
    });
    assert.equal(masteryOf("animals/bird", input).lastAt, "2026-11-05T00:00:00.000Z");
  });

  test("summarizeWords は手を付けた単語だけを words.ts の順で返す", () => {
    const input = inputOf({
      words: {
        "food/apple": { correct: 3 },
        "animals/dog": { correct: 1 },
      },
      pronunciation: { "animals/cat": { score: "ok", attempts: 1 } },
      cards: { "animals/bird": { views: 1 } },
    });
    const words = summarizeWords(input, allWordIds());
    assert.deepEqual(Object.keys(words), ["animals/dog", "animals/cat", "animals/bird", "food/apple"]);
    assert.equal(words["food/apple"].level, "mastered");
    assert.equal(words["animals/dog"].level, "learning");
    assert.equal(words["animals/cat"].level, "learning");
    assert.equal(words["animals/bird"].level, "learning");
  });

  test("0 件なら空のオブジェクト", () => {
    assert.deepEqual(summarizeWords(inputOf(), allWordIds()), {});
  });
});

describe("summarizeCategories", () => {
  test("未学習でも全カテゴリを返す", () => {
    const list = summarizeCategories(inputOf(), categories);
    assert.equal(list.length, categories.length);
    assert.equal(list.reduce((sum, c) => sum + c.total, 0), allWordIds().length);
    for (const category of list) {
      assert.equal(category.mastered, 0);
      assert.equal(category.learning, 0);
      assert.equal(category.unseen, category.total);
      assert.ok(category.label.length > 0 && category.emoji.length > 0);
    }
  });

  test("覚えた / 練習中 / まだ を数える", () => {
    const input = inputOf({
      words: { "animals/dog": { correct: 3 }, "animals/cat": { correct: 0, wrong: 1 } },
      pronunciation: { "animals/bird": { score: "ok", attempts: 1 } },
      cards: { "animals/fish": { views: 1 } },
    });
    const animals = summarizeCategories(input, categories).find((c) => c.id === "animals");
    assert.equal(animals.mastered, 1, "dog");
    assert.equal(animals.learning, 3, "cat と bird と fish");
    assert.equal(animals.unseen, animals.total - 4);
  });

  test("カテゴリの外の ID は数えない", () => {
    const input = inputOf({ words: { "unknown/word": { correct: 9 } } });
    const list = summarizeCategories(input, categories);
    assert.equal(list.reduce((sum, c) => sum + c.mastered, 0), 0);
  });
});
