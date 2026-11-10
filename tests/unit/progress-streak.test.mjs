import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { addDays } from "../../src/lib/progress/day.ts";
import { isStudiedDay, streakOf } from "../../src/lib/progress/streak.ts";

/**
 * 連続学習日数の判定 — issue #69 (判定部分)
 *
 * 固定したい主張:
 *  1. 今日まだでも、昨日まで続いていれば current は維持される (朝に 0 に戻さない)
 *  2. 2 日以上空いたら current は 0
 *  3. 月跨ぎ・年跨ぎ・閏年で日付が壊れない
 *  4. 未来の日付キーは無視する (端末の時計が進んでいても壊れない)
 *  5. 発音だけ・カードだけの日も「学習した日」に数える
 */

/** 学習した日を作る (rounds / attempts / カード のどれかが 1 以上) */
function studied(rounds = 1, attempts = 0, cardViews = 0) {
  return {
    quiz: { rounds, correct: rounds, total: rounds * 8 },
    pronunciation: { attempts, ok: 0 },
    cards: { views: cardViews },
  };
}

const REST = { quiz: { rounds: 0, correct: 0, total: 0 }, pronunciation: { attempts: 0, ok: 0 } };

describe("addDays", () => {
  test("日単位で前後に動く (月跨ぎ・年跨ぎ・閏年)", () => {
    assert.equal(addDays("2026-11-09", -1), "2026-11-08");
    assert.equal(addDays("2026-11-01", -1), "2026-10-31");
    assert.equal(addDays("2027-01-01", -1), "2026-12-31");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29", "閏年");
    assert.equal(addDays("2028-02-29", 1), "2028-03-01");
    assert.equal(addDays("2026-11-09", 0), "2026-11-09");
  });
});

describe("isStudiedDay", () => {
  test("クイズ・カード・発音のどれかがあれば学習した日", () => {
    assert.equal(isStudiedDay(studied(1)), true);
    assert.equal(isStudiedDay(studied(0, 1)), true);
    assert.equal(isStudiedDay(studied(0, 0, 1)), true, "カードだけの日");
    assert.equal(isStudiedDay(REST), false);
    assert.equal(isStudiedDay(null), false);
    assert.equal(isStudiedDay(undefined), false);
  });
});

describe("streakOf", () => {
  const TODAY = "2026-11-09";

  test("空の日次は 0 (新規ユーザーでも落ちない)", () => {
    for (const days of [{}, undefined, null]) {
      assert.deepEqual(streakOf(days, TODAY), {
        current: 0,
        longest: 0,
        studiedToday: false,
        lastStudyDay: null,
      });
    }
  });

  test("今日だけ学習した", () => {
    const streak = streakOf({ [TODAY]: studied() }, TODAY);
    assert.equal(streak.current, 1);
    assert.equal(streak.longest, 1);
    assert.equal(streak.studiedToday, true);
    assert.equal(streak.lastStudyDay, TODAY);
  });

  test("今日まだでも、昨日まで続いていれば current は維持される", () => {
    const days = {
      "2026-11-06": studied(),
      "2026-11-07": studied(),
      "2026-11-08": studied(),
    };
    const streak = streakOf(days, TODAY);
    assert.equal(streak.current, 3, "朝に 0 へ戻さない");
    assert.equal(streak.studiedToday, false, "「きょうも やろう」を出せる");
    assert.equal(streak.lastStudyDay, "2026-11-08");
  });

  test("昨日が抜けたら 0 (2 日以上空いた)", () => {
    const days = {
      "2026-11-05": studied(),
      "2026-11-06": studied(),
      "2026-11-07": studied(),
    };
    const streak = streakOf(days, TODAY);
    assert.equal(streak.current, 0);
    assert.equal(streak.longest, 3, "最長は残る");
  });

  test("今日と一昨日 (1 日抜け) なら current は 1", () => {
    const streak = streakOf({ "2026-11-07": studied(), [TODAY]: studied() }, TODAY);
    assert.equal(streak.current, 1);
    assert.equal(streak.longest, 1);
  });

  test("月跨ぎの連続", () => {
    const streak = streakOf(
      { "2026-10-30": studied(), "2026-10-31": studied(), "2026-11-01": studied() },
      "2026-11-01",
    );
    assert.equal(streak.current, 3);
    assert.equal(streak.lastStudyDay, "2026-11-01");
  });

  test("年跨ぎの連続", () => {
    const streak = streakOf(
      { "2026-12-30": studied(), "2026-12-31": studied(), "2027-01-01": studied() },
      "2027-01-01",
    );
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
  });

  test("年跨ぎで途切れたら 0", () => {
    const streak = streakOf({ "2026-12-30": studied(), "2026-12-31": studied() }, "2027-01-02");
    assert.equal(streak.current, 0);
    assert.equal(streak.longest, 2);
  });

  test("未来の日付キーは無視する", () => {
    const streak = streakOf({ "2026-11-10": studied(), "2026-11-11": studied() }, TODAY);
    assert.equal(streak.current, 0);
    assert.equal(streak.longest, 0);
    assert.equal(streak.studiedToday, false);
    assert.equal(streak.lastStudyDay, null);
  });

  test("未来の日付があっても過去の連続は正しく数える", () => {
    const streak = streakOf(
      { "2026-11-08": studied(), [TODAY]: studied(), "2026-11-12": studied() },
      TODAY,
    );
    assert.equal(streak.current, 2);
    assert.equal(streak.longest, 2);
    assert.equal(streak.lastStudyDay, TODAY);
  });

  test("発音だけの日も連続に数える", () => {
    const streak = streakOf({ "2026-11-08": studied(0, 2), "2026-11-02": studied(0, 1) }, TODAY);
    assert.equal(streak.current, 1, "昨日の発音だけでも維持");
    assert.equal(streak.longest, 1);
    assert.equal(streak.lastStudyDay, "2026-11-08");
  });

  test("長い連続のあとに短い連続が続いても longest が縮まない", () => {
    const days = {
      "2026-10-01": studied(),
      "2026-10-02": studied(),
      "2026-10-03": studied(),
      "2026-10-04": studied(),
      "2026-11-08": studied(),
      [TODAY]: studied(),
    };
    const streak = streakOf(days, TODAY);
    assert.equal(streak.longest, 4);
    assert.equal(streak.current, 2);
  });

  test("壊れたキー・壊れた値は無視する", () => {
    const days = {
      "11/09/2026": studied(),
      "2026-11-9": studied(),
      [TODAY]: null,
      "2026-11-08": { quiz: "x", pronunciation: 3 },
    };
    const streak = streakOf(days, TODAY);
    assert.equal(streak.current, 0);
    assert.equal(streak.longest, 0);
  });

  test("today が壊れていたら空として返す (無限ループにしない)", () => {
    assert.deepEqual(streakOf({ [TODAY]: studied() }, "not-a-day"), {
      current: 0,
      longest: 0,
      studiedToday: false,
      lastStudyDay: null,
    });
  });

  test("連続 400 日でも数え切れる (保持期間の上限)", () => {
    const days = {};
    for (let i = 0; i < 400; i += 1) days[addDays(TODAY, -i)] = studied();
    const streak = streakOf(days, TODAY);
    assert.equal(streak.current, 400);
    assert.equal(streak.longest, 400);
  });
});
