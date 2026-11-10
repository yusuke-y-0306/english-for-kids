import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { dayKeyOf, daysBetween } from "../../src/lib/progress/day.ts";
import {
  CARD_EVENT_MEMORY,
  PROGRESS_RETENTION_DAYS,
  QUIZ_ROUND_MEMORY,
  applyCardView,
  applyPronunciationAttempt,
  applyQuizRound,
  emptyProgressState,
  normalizeProgressState,
  pruneDays,
  seedWordsFromPronunciation,
  summaryForDay,
} from "../../src/lib/progress/state.ts";

/**
 * 学習履歴の保存形式と計算 — issue #4
 *
 * 固定したい主張:
 *  1. 壊れた / 古い / 手編集の JSON を読んでも落ちない (落ちると進捗ページが永久に開かない)
 *  2. 正解数が出題数を超えない (表示が 120% にならない)
 *  3. 日付は JST (UTC で切ると朝 9 時前の学習が前日扱いになる)
 *  4. 日次は 400 日で切る (ファイルが無限に育たない)
 *  5. 元の状態を書き換えない (React の再描画で数字が二重に増えない)
 *  6. 同じ roundId の再送で数字が水増しされない (#65 の冪等キー)
 */

const NOW = "2026-11-05T00:00:00.000Z";
const DAY = "2026-11-05";

describe("normalizeProgressState", () => {
  test("未保存 (undefined / null / 空) は空の状態になる", () => {
    for (const raw of [undefined, null, {}, 0, "x", []]) {
      const state = normalizeProgressState(raw);
      assert.deepEqual(state.days, {});
      assert.deepEqual(state.words, {});
      assert.equal(state.longestStreak, 0);
      assert.equal(state.lastStudyAt, null);
    }
  });

  test("壊れた値でも落ちず、読めるところだけ拾う", () => {
    const state = normalizeProgressState({
      version: 0,
      days: {
        "2026-11-04": { quiz: { rounds: "2", correct: 5, total: 3 }, pronunciation: {} },
        /* 日付の形が違うキーは捨てる */
        "11/05/2026": { quiz: { rounds: 1, correct: 1, total: 1 } },
        "2026-11-03": null,
      },
      words: {
        "cat-a": { correct: 2, wrong: -1, lastAt: 123 },
        "": { correct: 9 },
      },
      longestStreak: "7",
      lastStudyAt: 42,
    });

    assert.deepEqual(Object.keys(state.days), ["2026-11-04"]);
    /* correct は total に丸める */
    assert.deepEqual(state.days["2026-11-04"].quiz, { rounds: 2, correct: 3, total: 3 });
    /* 未定義のフィールドは 0 */
    assert.deepEqual(state.days["2026-11-04"].pronunciation, { attempts: 0, ok: 0 });
    /* 負の数は 0、空の単語 ID は捨てる */
    assert.deepEqual(Object.keys(state.words), ["cat-a"]);
    assert.deepEqual(state.words["cat-a"], { correct: 2, wrong: 0, lastAt: new Date(0).toISOString() });
    assert.equal(state.longestStreak, 7);
    assert.equal(state.lastStudyAt, null);
  });

  test("発音の ok が attempts を超えない", () => {
    const state = normalizeProgressState({
      days: { [DAY]: { pronunciation: { attempts: 3, ok: 9 } } },
    });
    assert.deepEqual(state.days[DAY].pronunciation, { attempts: 3, ok: 3 });
  });

  test("正しい値をそのまま保つ (再保存で数字が変わらない)", () => {
    const raw = {
      version: 1,
      days: {
        [DAY]: {
          quiz: { rounds: 1, correct: 6, total: 8 },
          pronunciation: { attempts: 2, ok: 1 },
          cards: { views: 0 },
        },
      },
      words: { "cat-a": { correct: 1, wrong: 1, lastAt: NOW } },
      cards: {},
      quizRoundIds: [],
      cardEventIds: [],
      longestStreak: 3,
      lastStudyAt: NOW,
      updatedAt: NOW,
    };
    assert.deepEqual(normalizeProgressState(raw), { ...raw, version: 1 });
  });

  test("移行フラグは true のときだけ残す", () => {
    assert.equal(normalizeProgressState({ migratedFromPronunciation: true }).migratedFromPronunciation, true);
    assert.equal(normalizeProgressState({ migratedFromPronunciation: "yes" }).migratedFromPronunciation, undefined);
  });
});

describe("dayKeyOf — JST 基準", () => {
  test("UTC 15:00 は JST の翌日", () => {
    assert.equal(dayKeyOf(new Date("2026-11-04T15:00:00Z")), "2026-11-05");
  });

  test("UTC 14:59 はまだ同じ日", () => {
    assert.equal(dayKeyOf(new Date("2026-11-04T14:59:59Z")), "2026-11-04");
  });

  test("年跨ぎ (UTC 12/31 15:00 = JST 1/1)", () => {
    assert.equal(dayKeyOf(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  });

  test("daysBetween は日数の差", () => {
    assert.equal(daysBetween("2026-11-05", "2026-11-05"), 0);
    assert.equal(daysBetween("2026-11-04", "2026-11-05"), 1);
    assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  });
});

describe("pruneDays", () => {
  test("400 日を超えたら古い方から落ちる", () => {
    const days = {};
    for (let i = 0; i < PROGRESS_RETENTION_DAYS + 5; i += 1) {
      const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      days[d] = { quiz: { rounds: 1, correct: 1, total: 1 }, pronunciation: { attempts: 0, ok: 0 } };
    }
    const pruned = pruneDays(days);
    assert.equal(Object.keys(pruned).length, PROGRESS_RETENTION_DAYS);
    /* 古い 5 日が消え、最後の日は残る */
    assert.equal(Object.keys(pruned).includes("2025-01-01"), false);
    const last = new Date(Date.UTC(2025, 0, 1) + (PROGRESS_RETENTION_DAYS + 4) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    assert.equal(Object.keys(pruned).includes(last), true);
  });

  test("ちょうど上限なら何も落とさない", () => {
    const days = {};
    for (let i = 0; i < 3; i += 1) {
      days[`2026-11-0${i + 1}`] = { quiz: { rounds: 0, correct: 0, total: 0 }, pronunciation: { attempts: 0, ok: 0 } };
    }
    assert.deepEqual(Object.keys(pruneDays(days, 3)).sort(), Object.keys(days).sort());
  });
});

describe("applyQuizRound", () => {
  test("日次と単語別が増える", () => {
    const state = emptyProgressState();
    const next = applyQuizRound(state, {
      day: DAY,
      now: NOW,
      results: [
        { wordId: "cat-a", correct: true },
        { wordId: "cat-a", correct: false },
        { wordId: "dog-b", correct: true },
      ],
    });

    assert.deepEqual(next.days[DAY].quiz, { rounds: 1, correct: 2, total: 3 });
    assert.deepEqual(next.words["cat-a"], { correct: 1, wrong: 1, lastAt: NOW });
    assert.deepEqual(next.words["dog-b"], { correct: 1, wrong: 0, lastAt: NOW });
    assert.equal(next.lastStudyAt, NOW);
  });

  test("同じ日に 2 ラウンド目は加算される", () => {
    const once = applyQuizRound(emptyProgressState(), {
      day: DAY,
      now: NOW,
      results: [{ wordId: "cat-a", correct: true }],
    });
    const twice = applyQuizRound(once, {
      day: DAY,
      now: NOW,
      results: [{ wordId: "cat-a", correct: true }],
    });
    assert.deepEqual(twice.days[DAY].quiz, { rounds: 2, correct: 2, total: 2 });
  });

  test("元の状態を書き換えない", () => {
    const state = emptyProgressState();
    applyQuizRound(state, { day: DAY, now: NOW, results: [{ wordId: "cat-a", correct: true }] });
    assert.deepEqual(state, emptyProgressState());
  });

  test("出題 0 件は数えない (空送信で水増しされない)", () => {
    const state = emptyProgressState();
    assert.equal(applyQuizRound(state, { day: DAY, now: NOW, results: [] }), state);
  });

  test("発音の日次を壊さない", () => {
    const withPronunciation = applyPronunciationAttempt(emptyProgressState(), {
      day: DAY,
      ok: true,
      now: NOW,
    });
    const next = applyQuizRound(withPronunciation, {
      day: DAY,
      now: NOW,
      results: [{ wordId: "cat-a", correct: true }],
    });
    assert.deepEqual(next.days[DAY].pronunciation, { attempts: 1, ok: 1 });
  });
});

describe("applyQuizRound — 冪等キー (#65)", () => {
  const round = (roundId) => ({
    roundId,
    day: DAY,
    now: NOW,
    results: [{ wordId: "cat-a", correct: true }],
  });

  test("同じ roundId の再送は数えない (同じ状態をそのまま返す)", () => {
    const once = applyQuizRound(emptyProgressState(), round("r-1"));
    const twice = applyQuizRound(once, round("r-1"));

    /* 参照が同じ = 呼び出し側は「書く必要が無い」と判断できる */
    assert.equal(twice, once);
    assert.deepEqual(twice.days[DAY].quiz, { rounds: 1, correct: 1, total: 1 });
    assert.deepEqual(twice.words["cat-a"], { correct: 1, wrong: 0, lastAt: NOW });
  });

  test("違う roundId なら加算する", () => {
    const once = applyQuizRound(emptyProgressState(), round("r-1"));
    const twice = applyQuizRound(once, round("r-2"));
    assert.deepEqual(twice.days[DAY].quiz, { rounds: 2, correct: 2, total: 2 });
    assert.deepEqual(twice.quizRoundIds, ["r-2", "r-1"]);
  });

  test("2 ラウンド前の再送も弾く (直近を輪で覚えている)", () => {
    let state = emptyProgressState();
    state = applyQuizRound(state, round("r-1"));
    state = applyQuizRound(state, round("r-2"));
    assert.equal(applyQuizRound(state, round("r-1")), state);
  });

  test("roundId が空なら冪等性は効かない (保守・テスト用の逃げ道)", () => {
    let state = applyQuizRound(emptyProgressState(), round(""));
    state = applyQuizRound(state, round(""));
    assert.deepEqual(state.days[DAY].quiz.rounds, 2);
    assert.deepEqual(state.quizRoundIds, []);
  });

  test(`覚えるのは新しい方から ${QUIZ_ROUND_MEMORY} 件まで`, () => {
    let state = emptyProgressState();
    for (let i = 0; i < QUIZ_ROUND_MEMORY + 5; i += 1) {
      state = applyQuizRound(state, round(`r-${i}`));
    }
    assert.equal(state.quizRoundIds.length, QUIZ_ROUND_MEMORY);
    assert.equal(state.quizRoundIds[0], `r-${QUIZ_ROUND_MEMORY + 4}`);
    /* 忘れた古い ID はもう弾けない (覚えていないものを弾くことはできない) */
    assert.equal(state.quizRoundIds.includes("r-0"), false);
  });

  test("単語を持たない問題 (文法) は日次だけ数える", () => {
    const next = applyQuizRound(emptyProgressState(), {
      roundId: "r-grammar",
      day: DAY,
      now: NOW,
      results: [
        { wordId: null, correct: true },
        { wordId: null, correct: false },
      ],
    });
    assert.deepEqual(next.days[DAY].quiz, { rounds: 1, correct: 1, total: 2 });
    assert.deepEqual(next.words, {});
  });

  test("壊れた quizRoundIds は文字列だけ・重複なし・上限までに正規化される", () => {
    const state = normalizeProgressState({
      quizRoundIds: ["a", "a", 42, "", "b", ...Array.from({ length: 100 }, (_, i) => `x-${i}`)],
    });
    assert.deepEqual(state.quizRoundIds.slice(0, 2), ["a", "b"]);
    assert.equal(state.quizRoundIds.length, QUIZ_ROUND_MEMORY);

    for (const broken of [undefined, null, "abc", 0, { a: 1 }]) {
      assert.deepEqual(normalizeProgressState({ quizRoundIds: broken }).quizRoundIds, []);
    }
  });
});

describe("summaryForDay", () => {
  test("遊んでいない日は 0", () => {
    assert.deepEqual(summaryForDay(emptyProgressState(), DAY), { rounds: 0, correct: 0, total: 0 });
  });

  test("その日のクイズ集計だけを返す (発音は含めない)", () => {
    let state = applyQuizRound(emptyProgressState(), {
      roundId: "r-1",
      day: DAY,
      now: NOW,
      results: [
        { wordId: "cat-a", correct: true },
        { wordId: null, correct: false },
      ],
    });
    state = applyPronunciationAttempt(state, { day: DAY, ok: true, now: NOW });
    assert.deepEqual(summaryForDay(state, DAY), { rounds: 1, correct: 1, total: 2 });
    assert.deepEqual(summaryForDay(state, "2026-11-06"), { rounds: 0, correct: 0, total: 0 });
  });
});

describe("applyPronunciationAttempt", () => {
  test("attempts が増え、ok だけが「できた」に数えられる", () => {
    let state = applyPronunciationAttempt(emptyProgressState(), { day: DAY, ok: true, now: NOW });
    state = applyPronunciationAttempt(state, { day: DAY, ok: false, now: NOW });
    assert.deepEqual(state.days[DAY].pronunciation, { attempts: 2, ok: 1 });
  });

  test("単語別の正誤は触らない (発音ストアが正)", () => {
    const state = applyPronunciationAttempt(emptyProgressState(), { day: DAY, ok: true, now: NOW });
    assert.deepEqual(state.words, {});
  });

  test("元の状態を書き換えない", () => {
    const state = emptyProgressState();
    applyPronunciationAttempt(state, { day: DAY, ok: true, now: NOW });
    assert.deepEqual(state, emptyProgressState());
  });
});

describe("seedWordsFromPronunciation — 移行 (#66)", () => {
  const at = "2026-11-01T00:00:00.000Z";
  const byWord = {
    "animals/dog": { score: "ok", attempts: 3, updatedAt: at },
    "food/apple": { score: "retry", attempts: 2, updatedAt: at },
  };

  test("byWord から単語別の種を蒔き、印を立てる", () => {
    const next = seedWordsFromPronunciation(emptyProgressState(), byWord, NOW);

    /* 直近が ok なら全回を正解、それ以外なら全回を不正解として蒔く (近似) */
    assert.deepEqual(next.words["animals/dog"], { correct: 3, wrong: 0, lastAt: at });
    assert.deepEqual(next.words["food/apple"], { correct: 0, wrong: 2, lastAt: at });
    assert.equal(next.migratedFromPronunciation, true);
    /* 日次は遡及できない (移行後の試行から数える) */
    assert.deepEqual(next.days, {});
  });

  test("2 回目以降は種まきしない (同じ参照を返す)", () => {
    const once = seedWordsFromPronunciation(emptyProgressState(), byWord, NOW);
    const twice = seedWordsFromPronunciation(once, byWord, NOW);
    assert.equal(twice, once);
    assert.deepEqual(twice.words, once.words);
  });

  test("クイズで既に数えている単語は触らない (二重計上しない)", () => {
    const withQuiz = applyQuizRound(emptyProgressState(), {
      roundId: "r-1",
      day: DAY,
      now: NOW,
      results: [{ wordId: "animals/dog", correct: true }],
    });
    const next = seedWordsFromPronunciation(withQuiz, byWord, NOW);

    /* クイズの 1 回のまま。発音の 3 回は足さない */
    assert.deepEqual(next.words["animals/dog"], { correct: 1, wrong: 0, lastAt: NOW });
    /* クイズに無い単語だけが蒔かれる */
    assert.deepEqual(next.words["food/apple"], { correct: 0, wrong: 2, lastAt: at });
  });

  test("byWord が無い / 空 / 壊れていても落ちず、印だけ立てる", () => {
    for (const source of [undefined, null, {}, { "": { score: "ok", attempts: 3 } }, { "a/b": { score: "ok", attempts: 0 } }]) {
      const next = seedWordsFromPronunciation(emptyProgressState(), source, NOW);
      assert.deepEqual(next.words, {});
      assert.equal(next.migratedFromPronunciation, true);
    }
  });

  test("updatedAt が読めない日時なら now を使う", () => {
    const next = seedWordsFromPronunciation(
      emptyProgressState(),
      { "animals/dog": { score: "ok", attempts: 1, updatedAt: 42 } },
      NOW,
    );
    assert.equal(next.words["animals/dog"].lastAt, NOW);
  });

  test("元の状態を書き換えない", () => {
    const state = emptyProgressState();
    seedWordsFromPronunciation(state, byWord, NOW);
    assert.deepEqual(state, emptyProgressState());
  });
});

describe("applyCardView — カードの記録 (#76)", () => {
  const view = (eventId, wordId = "animals/dog") => ({ eventId, day: DAY, now: NOW, wordId });

  test("日次と単語別のカード回数が増える", () => {
    const next = applyCardView(emptyProgressState(), view("e-1"));

    assert.deepEqual(next.days[DAY].cards, { views: 1 });
    assert.deepEqual(next.cards["animals/dog"], { views: 1, lastAt: NOW });
    assert.equal(next.lastStudyAt, NOW);
    /* 見ただけではクイズの正誤は動かない */
    assert.deepEqual(next.words, {});
  });

  test("違う eventId なら同じ単語も数える", () => {
    const once = applyCardView(emptyProgressState(), view("e-1"));
    const twice = applyCardView(once, view("e-2"));

    assert.deepEqual(twice.days[DAY].cards, { views: 2 });
    assert.deepEqual(twice.cards["animals/dog"], { views: 2, lastAt: NOW });
  });

  test("同じ eventId の再送は数えない (同じ状態をそのまま返す)", () => {
    const once = applyCardView(emptyProgressState(), view("e-1"));
    const twice = applyCardView(once, view("e-1"));

    assert.equal(twice, once);
    assert.deepEqual(twice.days[DAY].cards, { views: 1 });
    assert.deepEqual(twice.cards["animals/dog"], { views: 1, lastAt: NOW });
  });

  test("クイズ・発音の日次を壊さない", () => {
    const quizzed = applyQuizRound(emptyProgressState(), {
      roundId: "r-1",
      day: DAY,
      now: NOW,
      results: [{ wordId: "animals/dog", correct: true }],
    });
    const spoken = applyPronunciationAttempt(quizzed, { day: DAY, ok: true, now: NOW });
    const next = applyCardView(spoken, view("e-1"));

    assert.deepEqual(next.days[DAY].quiz, { rounds: 1, correct: 1, total: 1 });
    assert.deepEqual(next.days[DAY].pronunciation, { attempts: 1, ok: 1 });
    assert.deepEqual(next.days[DAY].cards, { views: 1 });
  });

  test("eventId は CARD_EVENT_MEMORY 件だけ覚える (古いものは忘れる)", () => {
    let state = emptyProgressState();
    for (let i = 0; i < CARD_EVENT_MEMORY + 3; i += 1) {
      state = applyCardView(state, view(`e-${i}`));
    }
    assert.equal(state.cardEventIds.length, CARD_EVENT_MEMORY);
    assert.equal(state.cardEventIds[0], `e-${CARD_EVENT_MEMORY + 2}`);
    /* 忘れた古い ID は再送しても数えてしまう (保持件数の仕様) */
    const again = applyCardView(state, view("e-0"));
    assert.deepEqual(again.days[DAY].cards, { views: CARD_EVENT_MEMORY + 4 });
  });

  test("元の状態を書き換えない", () => {
    const state = emptyProgressState();
    applyCardView(state, view("e-1"));
    assert.deepEqual(state, emptyProgressState());
  });
});

describe("normalizeProgressState — カード (#76)", () => {
  test("カードの日次と単語別を読み直せる", () => {
    const state = normalizeProgressState({
      days: { [DAY]: { cards: { views: "2" } } },
      cards: { "animals/dog": { views: 3, lastAt: NOW } },
      cardEventIds: ["e-1", "e-1", 42, ""],
    });

    assert.deepEqual(state.days[DAY].cards, { views: 2 });
    assert.deepEqual(state.cards["animals/dog"], { views: 3, lastAt: NOW });
    assert.deepEqual(state.cardEventIds, ["e-1"]);
  });

  test("古い保存形式 (cards が無い) でも 0 で埋まる", () => {
    const state = normalizeProgressState({ days: { [DAY]: { quiz: { rounds: 1, correct: 1, total: 1 } } } });
    assert.deepEqual(state.days[DAY].cards, { views: 0 });
    assert.deepEqual(state.cards, {});
    assert.deepEqual(state.cardEventIds, []);
  });
});
