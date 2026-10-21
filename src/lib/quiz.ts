/**
 * クイズ・ゲーム機能のデータ — issue #3
 *
 * 設計方針:
 * - 1ラウンド = 8問。レベルは 3つ（はじめて / ちゅうきゅう / じょうきゅう）。
 * - 初級は `words.ts` の単語から毎回ランダムに出題する（同じ単語でも、
 *   選択肢と順番が変わるので繰り返し遊べる）。
 * - 中級・上級は固定の問題プールからランダムに8問を抜き出す。
 * - 問題の生成はクライアントの「スタート」押下時だけ行う。
 *   （SSR 時に Math.random を走らせるとハイドレーションがズレるため）
 */

import { categories, type Word } from "./words";

export type QuizLevelId = "beginner" | "intermediate" | "advanced";

export type QuizQuestion = {
  id: string;
  /** 大きく見せる絵文字（初級のみ） */
  display?: string;
  /** 問題文（英語。中級・上級で使う） */
  promptEn?: string;
  /** 問題文（日本語） */
  promptJa: string;
  /** 4つの選択肢 */
  choices: string[];
  /** 正解の index */
  answer: number;
  /** 答え合わせのときに出すやさしい説明 */
  explanation: string;
};

export type QuizLevel = {
  id: QuizLevelId;
  label: string;
  en: string;
  emoji: string;
  desc: string;
  /** カードの背景色（hex） */
  color: string;
  ink: string;
};

export const QUIZ_LENGTH = 8;

export const quizLevels: QuizLevel[] = [
  {
    id: "beginner",
    label: "はじめて",
    en: "Beginner",
    emoji: "🌱",
    desc: "たんごの いみが わかるかな？",
    color: "#eef7e2",
    ink: "#38702f",
  },
  {
    id: "intermediate",
    label: "ちゅうきゅう",
    en: "Intermediate",
    emoji: "🌻",
    desc: "ぶんに あう ことばを えらぼう。",
    color: "#fff3d6",
    ink: "#a85f08",
  },
  {
    id: "advanced",
    label: "じょうきゅう",
    en: "Advanced",
    emoji: "🚀",
    desc: "ぶんぽうに ちょうせん！",
    color: "#e6f6ff",
    ink: "#1a6f95",
  },
];

/* ------------------------------------------------------------------ *
 * ユーティリティ
 * ------------------------------------------------------------------ */

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueByEn(words: Word[]): Word[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    if (seen.has(w.en)) return false;
    seen.add(w.en);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 初級 — 単語当て（words.ts から生成）
 * ------------------------------------------------------------------ */

function buildBeginnerQuestions(count: number): QuizQuestion[] {
  const all = categories.flatMap((c) =>
    c.words.map((w) => ({ ...w, categoryId: c.id })),
  );
  const picked = shuffle(all).slice(0, count);

  return picked.map((word, i) => {
    const category = categories.find((c) => c.id === word.categoryId);
    const sameCategory = uniqueByEn(
      (category?.words ?? []).filter((w) => w.en !== word.en),
    );
    const otherCategories = uniqueByEn(
      all.filter((w) => w.categoryId !== word.categoryId && w.en !== word.en),
    );

    // 同じカテゴリの単語を優先。足りなければ他のカテゴリから補う。
    const distractors: Word[] = shuffle(sameCategory).slice(0, 3);
    if (distractors.length < 3) {
      for (const w of shuffle(otherCategories)) {
        if (distractors.length >= 3) break;
        if (distractors.some((d) => d.en === w.en)) continue;
        distractors.push(w);
      }
    }

    const choices = shuffle([word, ...distractors].map((w) => w.en));

    return {
      id: `beginner-${i}-${word.en}`,
      display: word.emoji,
      promptJa: `「${word.ja}」は えいごで なに？`,
      choices,
      answer: choices.indexOf(word.en),
      explanation: `${word.ja} は えいごで “${word.en}” だよ。`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 中級 — 文に合うことば
 * ------------------------------------------------------------------ */

const intermediatePool: Omit<QuizQuestion, "id">[] = [
  {
    promptEn: "I ___ a dog.",
    promptJa: "わたしは いぬを かっているよ。",
    choices: ["have", "has", "am", "is"],
    answer: 0,
    explanation: "「わたし」は I。I の ときは have を つかうよ。",
  },
  {
    promptEn: "She ___ a teacher.",
    promptJa: "かのじょは せんせいです。",
    choices: ["is", "are", "am", "be"],
    answer: 0,
    explanation: "she（かのじょ）は ひとり。だから is だよ。",
  },
  {
    promptEn: "___ you like apples?",
    promptJa: "りんごは すき？",
    choices: ["Do", "Does", "Are", "Is"],
    answer: 0,
    explanation: "you の しつもんは Do で はじめるよ。",
  },
  {
    promptEn: "This is ___ orange.",
    promptJa: "これは オレンジです。",
    choices: ["an", "a", "some", "two"],
    answer: 0,
    explanation: "a・i・u・e・o の おとは an を つかうよ。orange は o から はじまるね。",
  },
  {
    promptEn: "There ___ two cats.",
    promptJa: "ねこが 2ひき いるよ。",
    choices: ["are", "is", "am", "be"],
    answer: 0,
    explanation: "two cats は ふくすう。だから are だよ。",
  },
  {
    promptEn: "I can ___ fast.",
    promptJa: "わたしは はやく はしれるよ。",
    choices: ["run", "runs", "running", "ran"],
    answer: 0,
    explanation: "can の あとは どうしの もとの かたち（run）だよ。",
  },
  {
    promptEn: "He ___ to school every day.",
    promptJa: "かれは まいにち がっこうへ いくよ。",
    choices: ["goes", "go", "going", "went"],
    answer: 0,
    explanation: "he の ときは どうしに s（es）が つくよ。go → goes。",
  },
  {
    promptEn: "___ is your name?",
    promptJa: "おなまえは なんですか？",
    choices: ["What", "Who", "Where", "How"],
    answer: 0,
    explanation: "「なに」を きくときは What だよ。",
  },
  {
    promptEn: "I have two ___.",
    promptJa: "はこを 2つ もっているよ。",
    choices: ["boxes", "boxs", "boxies", "box"],
    answer: 0,
    explanation: "box は x で おわるから、es を つけて boxes になるよ。",
  },
  {
    promptEn: "Look! It ___ raining.",
    promptJa: "みて！あめが ふっているよ。",
    choices: ["is", "are", "am", "be"],
    answer: 0,
    explanation: "it は ひとつ。だから is だよ。",
  },
  {
    promptEn: "I like cats, ___ I don't like dogs.",
    promptJa: "ねこは すきだけど、いぬは すきじゃないよ。",
    choices: ["but", "and", "so", "because"],
    answer: 0,
    explanation: "「〜だけど」と つなぐときは but だよ。",
  },
  {
    promptEn: "How many ___ do you have?",
    promptJa: "ペンを なんぼん もっている？",
    choices: ["pens", "pen", "penses", "penes"],
    answer: 0,
    explanation: "How many の あとは ふくすうの かたち。pen → pens。",
  },
];

/* ------------------------------------------------------------------ *
 * 上級 — 文法・文の選択
 * ------------------------------------------------------------------ */

const advancedPool: Omit<QuizQuestion, "id">[] = [
  {
    promptJa: "ただしい ぶんは どれ？",
    choices: [
      "She doesn't like carrots.",
      "She don't like carrots.",
      "She not likes carrots.",
      "She doesn't likes carrots.",
    ],
    answer: 0,
    explanation:
      "she の 否定は doesn't。うしろの どうしは もとの かたち（like）だよ。",
  },
  {
    promptEn: "I have lived here ___ 2019.",
    promptJa: "2019年から ずっと ここに すんでいるよ。",
    choices: ["since", "for", "from", "at"],
    answer: 0,
    explanation: "since は「〜から（時点）」、for は「〜のあいだ（期間）」だよ。",
  },
  {
    promptEn: "If it ___ tomorrow, we'll stay home.",
    promptJa: "あした あめが ふったら、いえに いるよ。",
    choices: ["rains", "rain", "rained", "raining"],
    answer: 0,
    explanation:
      "If の ぶん（じょうけん）では、みらいの ことでも げんざいけいを つかうよ。",
  },
  {
    promptEn: "This book is ___ than that one.",
    promptJa: "この ほんは あの ほんより おもしろいよ。",
    choices: [
      "more interesting",
      "interesting",
      "most interesting",
      "interestinger",
    ],
    answer: 0,
    explanation:
      "ながい ことばは -er を つけず、more を つけて くらべるよ。",
  },
  {
    promptEn: "He asked me ___ I was hungry.",
    promptJa: "かれは わたしに「おなか すいてる？」と きいたよ。",
    choices: ["if", "that", "what", "because"],
    answer: 0,
    explanation: "「〜かどうか」は if（または whether）で つなぐよ。",
  },
  {
    promptEn: "There are ___ apples than bananas.",
    promptJa: "バナナより りんごの ほうが すくないよ。",
    choices: ["fewer", "less", "few", "little"],
    answer: 0,
    explanation:
      "りんごの ように かぞえられる ものは fewer、かぞえられない ものは less だよ。",
  },
  {
    promptEn: "I'm looking forward to ___ you.",
    promptJa: "あなたに あえるのを たのしみに しているよ。",
    choices: ["seeing", "see", "saw", "seen"],
    answer: 0,
    explanation:
      "look forward to の to は ぜんちし。うしろは 〜ing の かたちになるよ。",
  },
  {
    promptEn: "The cake ___ by my mother yesterday.",
    promptJa: "その ケーキは きのう おかあさんに つくられたよ。",
    choices: ["was made", "made", "is made", "makes"],
    answer: 0,
    explanation:
      "「〜された」は うけみ。yesterday があるので かこけい was made だよ。",
  },
  {
    promptEn: "She is the ___ girl in our class.",
    promptJa: "かのじょは クラスで いちばん せが たかいよ。",
    choices: ["tallest", "tall", "taller", "most tall"],
    answer: 0,
    explanation:
      "「いちばん〜」は さいじょうきゅう。tall は -est を つけて tallest。",
  },
  {
    promptEn: "___ hard, and you will succeed.",
    promptJa: "がんばれば、きっと うまくいくよ。",
    choices: ["Work", "Working", "To work", "Worked"],
    answer: 0,
    explanation:
      "「〜しなさい、そうすれば…」は めいれいぶん + and で つなぐよ。",
  },
  {
    promptEn: "This is the restaurant ___ we ate last night.",
    promptJa: "ここが ゆうべ たべた レストランだよ。",
    choices: ["where", "which", "when", "who"],
    answer: 0,
    explanation:
      "ばしょを せつめいする ときは where。うしろは かんせいした ぶんになるよ。",
  },
  {
    promptEn: "Neither Tom ___ his friends were there.",
    promptJa: "トムも かれの ともだちも そこには いなかったよ。",
    choices: ["nor", "or", "and", "but"],
    answer: 0,
    explanation: "neither A nor B で「AもBも 〜ない」という かたちだよ。",
  },
];

/* ------------------------------------------------------------------ *
 * ラウンド生成
 * ------------------------------------------------------------------ */

function fromPool(
  pool: Omit<QuizQuestion, "id">[],
  idPrefix: string,
  count: number,
): QuizQuestion[] {
  return shuffle(pool)
    .slice(0, count)
    .map((q, i) => {
      // 正解の位置がいつも同じにならないよう、選択肢も並べ替える
      const correct = q.choices[q.answer];
      const choices = shuffle(q.choices);
      return {
        ...q,
        id: `${idPrefix}-${i}`,
        choices,
        answer: choices.indexOf(correct),
      };
    });
}

/**
 * レベルに応じた1ラウンド（QUIZ_LENGTH 問）を作る。
 * クライアントのクリックハンドラから呼ぶこと（SSR では呼ばない）。
 */
export function buildRound(
  level: QuizLevelId,
  count: number = QUIZ_LENGTH,
): QuizQuestion[] {
  switch (level) {
    case "beginner":
      return buildBeginnerQuestions(count);
    case "intermediate":
      return fromPool(intermediatePool, "intermediate", count);
    case "advanced":
      return fromPool(advancedPool, "advanced", count);
  }
}

/** 正答数から星の数（0〜3）を決める */
export function starsFor(correct: number, total: number): number {
  if (total === 0) return 0;
  const ratio = correct / total;
  if (ratio >= 0.9) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.5) return 1;
  return 0;
}
