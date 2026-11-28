import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { describe } from "node:test";

import {
  PHONICS_ROUND_SIZE,
  categoryOf,
  familyChoices,
  familySuffix,
  initialChoices,
  initialOf,
  initialsOf,
  letterChoices,
  pickRound,
  shuffle,
  wordsStartingWith,
} from "../../src/lib/phonics.ts";

/**
 * フォニックスの問題づくり — issue #88
 *
 * ここで固定したいのは「**正解が 2 つに見える問題を作らない**」こと。
 * 同じ文字をダミーに出す / 同じ頭文字の語を出す / 同じ family の語を出す、
 * のどれも子どもには「どれも正解」に見える。純粋関数なので境界を直接叩く。
 */

const word = (id, en, ja = "いみ", emoji = "🔤") => ({ id, en, ja, emoji, audio: null });

/** 決定的な乱数 (線形合同法)。並びが固定できるので失敗を再現できる */
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz"
  .split("")
  .map((letter) => word(`phonics/${letter}`, letter));

const EXAMPLES = [
  word("phonics-words/apple", "apple"),
  word("phonics-words/ant", "ant"),
  word("phonics-words/ball", "ball"),
  word("phonics-words/bear", "bear"),
  word("phonics-words/cat", "cat"),
  word("phonics-words/cup", "cup"),
  word("phonics-words/dog", "dog"),
  word("phonics-words/duck", "duck"),
];

const FAMILY_WORDS = [
  ...["cat", "bat", "hat", "mat", "rat", "sat", "fat", "pat"].map((en) =>
    word(`word-family-at/${en}`, en),
  ),
  ...["can", "fan", "man", "pan", "ran", "van", "tan", "ban"].map((en) =>
    word(`word-family-an/${en}`, en),
  ),
  ...["big", "dig", "fig", "pig", "wig", "jig", "rig", "zig"].map((en) =>
    word(`word-family-ig/${en}`, en),
  ),
];

describe("initialOf / familySuffix", () => {
  test("頭文字は小文字で返し、英字でなければ空文字", () => {
    assert.equal(initialOf("apple"), "a");
    assert.equal(initialOf("Apple"), "a");
    assert.equal(initialOf("  dog"), "d");
    assert.equal(initialOf(""), "");
    assert.equal(initialOf("1st"), "");
    assert.equal(initialOf("あ"), "");
  });

  test("family の ID から 綴り型 を取り出す", () => {
    assert.equal(familySuffix("word-family-at"), "at");
    assert.equal(familySuffix("word-family-op"), "op");
    assert.equal(categoryOf("word-family-at/cat"), "word-family-at");
    assert.equal(categoryOf("animals/dog"), "animals");
  });
});

describe("letterChoices (おと → もじ)", () => {
  test("正解を含む 4 択で、文字が重複しない", () => {
    const answer = LETTERS.find((item) => item.en === "a");
    const choices = letterChoices(answer, LETTERS, 4, seeded(7));
    assert.equal(choices.length, 4);
    assert.ok(choices.some((choice) => choice.id === answer.id));
    const letters = choices.map((choice) => choice.en);
    assert.equal(new Set(letters).size, 4, "同じ文字を 2 つ出さない");
  });

  test("乱数が変われば並びも変わる (正解の位置を固定しない)", () => {
    const answer = LETTERS.find((item) => item.en === "m");
    const positions = new Set();
    for (let seed = 1; seed <= 20; seed += 1) {
      const choices = letterChoices(answer, LETTERS, 4, seeded(seed));
      positions.add(choices.findIndex((choice) => choice.id === answer.id));
    }
    assert.equal(positions.size, 4, "正解が 4 か所すべてに散る");
  });
});

describe("initialChoices (代表語 → 頭文字)", () => {
  test("ダミーの頭文字は正解の頭文字と重ならない", () => {
    const target = EXAMPLES.find((item) => item.en === "apple");
    const answer = LETTERS.find((item) => item.en === "a");
    const choices = initialChoices(answer, target, LETTERS, 4, seeded(3));

    assert.equal(choices.length, 4);
    assert.ok(choices.some((choice) => choice.id === answer.id));
    const initials = choices.map((choice) => choice.en);
    assert.equal(new Set(initials).size, 4);
    assert.ok(
      choices
        .filter((choice) => choice.id !== answer.id)
        .every((choice) => choice.en !== "a"),
      "「a」がダミーに混ざると正解が 2 つに見える",
    );
  });
});

describe("familyChoices (おなじ おと)", () => {
  test("ダミーは別の family の語だけで、同じ語を重複させない", () => {
    const answer = FAMILY_WORDS.find((item) => item.id === "word-family-at/cat");
    const choices = familyChoices(answer, FAMILY_WORDS, 4, seeded(11));

    assert.equal(choices.length, 4);
    assert.ok(choices.some((choice) => choice.id === answer.id));
    for (const choice of choices) {
      if (choice.id === answer.id) continue;
      assert.notEqual(
        categoryOf(choice.id),
        "word-family-at",
        "同じ family の語は正解が 2 つに見えるのでダミーにしない",
      );
    }
    assert.equal(new Set(choices.map((choice) => choice.en)).size, 4);
  });
});

describe("pickRound", () => {
  test("8 問を重複なく選ぶ", () => {
    const picked = pickRound(LETTERS, PHONICS_ROUND_SIZE, seeded(5));
    assert.equal(picked.length, PHONICS_ROUND_SIZE);
    assert.equal(new Set(picked.map((item) => item.id)).size, PHONICS_ROUND_SIZE);
  });

  test("候補が足りなければ繰り返して埋める (画面を止めない)", () => {
    const small = EXAMPLES.slice(0, 3);
    const picked = pickRound(small, 8, seeded(2));
    assert.equal(picked.length, 8);
    assert.ok(
      picked.every((item) => small.some((candidate) => candidate.id === item.id)),
      "候補に無い語を作らない",
    );
  });

  test("空なら空 (落ちない)", () => {
    assert.deepEqual(pickRound([], 8, seeded(1)), []);
  });
});

describe("語彙ヘルパー", () => {
  test("頭文字で語を引ける", () => {
    assert.deepEqual(
      wordsStartingWith(EXAMPLES, "a").map((item) => item.en),
      ["apple", "ant"],
    );
    assert.deepEqual(wordsStartingWith(EXAMPLES, "z"), []);
  });

  test("使える頭文字の一覧は重複なし・整列済み", () => {
    assert.deepEqual(initialsOf(EXAMPLES), ["a", "b", "c", "d"]);
  });

  test("shuffle は要素を落とさない", () => {
    const shuffled = shuffle(["a", "b", "c", "d"], seeded(9));
    assert.deepEqual([...shuffled].sort(), ["a", "b", "c", "d"]);
  });
});

/* ------------------------------------------------------------------ */
/* 実データとの突き合わせ — コンテンツが揃っていることを機械が見る      */
/* ------------------------------------------------------------------ */

const DIRECTORY = "content/vocabulary";

async function categoryData(id) {
  const raw = await readFile(path.join(DIRECTORY, `${id}.json`), "utf8");
  return JSON.parse(raw);
}

describe("content/vocabulary のフォニックス (#88)", () => {
  test("26 文字そろっていて、全部にフォニーム音の読み (tts) がある", async () => {
    const phonics = await categoryData("phonics");
    assert.equal(phonics.words.length, 26);
    assert.deepEqual(
      phonics.words.map((item) => item.en),
      "abcdefghijklmnopqrstuvwxyz".split(""),
    );
    for (const item of phonics.words) {
      assert.equal(item.pos, "letter");
      assert.ok(item.tts && item.tts.length > 0, `${item.id} に tts がありません`);
      assert.ok(item.audio, `${item.id} に音声がありません`);
    }
  });

  test("各文字に代表語が 3 つずつある (x だけは語尾の音で教える)", async () => {
    const phonicsWords = await categoryData("phonics-words");
    const counts = new Map();
    for (const item of phonicsWords.words) {
      const initial = initialOf(item.en);
      counts.set(initial, (counts.get(initial) ?? 0) + 1);
    }
    /**
     * `x` は英語の語頭にほぼ現れないので、フォニックスでは **語尾の音** として
     * 教える (box / mix / wax)。したがって代表語の頭文字に `x` は現れない。
     */
    assert.equal(counts.get("x"), undefined, "x で始まる代表語は作らない");
    for (const letter of "abcdefghijklmnopqrstuvwyz") {
      assert.ok(
        (counts.get(letter) ?? 0) >= 3,
        `${letter} の代表語が 3 つ未満です (${counts.get(letter) ?? 0})`,
      );
    }
    /* x の 3 語 (box / mix / wax) は b・m・w の数に足される */
    assert.equal(
      [...counts.values()].reduce((total, count) => total + count, 0),
      78,
    );
  });

  test("CVC word family は 5 family × 8 語 で、音声が埋まっている", async () => {
    const files = (await readdir(DIRECTORY))
      .filter((name) => name.startsWith("word-family-"))
      .sort();
    assert.equal(files.length, 5, "word-family-*.json が 5 本");

    let total = 0;
    for (const file of files) {
      const data = JSON.parse(await readFile(path.join(DIRECTORY, file), "utf8"));
      const suffix = familySuffix(data.id);
      assert.equal(data.words.length, 8, `${data.id} は 8 語`);
      for (const item of data.words) {
        total += 1;
        assert.ok(
          item.en.endsWith(suffix),
          `${item.en} は -${suffix} で終わっていません`,
        );
        assert.ok(item.audio, `${item.id} に音声がありません`);
      }
    }
    assert.equal(total, 40);
  });
});
