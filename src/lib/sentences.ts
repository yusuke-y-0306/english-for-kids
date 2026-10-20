/**
 * 単語並べ替え（文章作成）機能のデータ — issue #10 / #14
 *
 * 設計方針:
 * - 1タスク = 「相手の発言（質問/会話）」+「単語カード 5〜10枚」+「文法パターン」+「正解時のお返事」
 * - カードにはダミー（distractor）を混ぜる。使わないカードがあってよい。
 * - 正解は1つではない。文法が正しく、相手の発言に対して意味が通れば正解。
 *   → 判定は `GrammarChecker`（文法パターン照合 + 主語/be の一致 + a/an）に任せる。
 *     これにより、たとえば「I have a dog」も「I have a big dog」も「I have a small cat」も
 *     列挙しなくても正解になる（issue #14）。
 */

import { GrammarChecker } from "./grammar/GrammarChecker";
import type { GrammarPattern } from "./grammar/types";

export type Task = {
  /** 一意なID */
  id: string;
  /** 相手の絵文字 */
  emoji: string;
  /** 相手の名前 */
  speaker: string;
  /** 場面の絵文字 */
  scene: string;
  /** 相手の発言（英語） */
  prompt: string;
  /** 相手の発言のやさしい日本語 */
  promptJa: string;
  /** ヒント（単語の意味など） */
  hintJa: string;
  /** 単語カード（5〜10枚） */
  words: string[];
  /** 文法パターン（このタスクで「正しい文」とみなす文型） */
  patterns: GrammarPattern[];
  /** 正解したときのお返事 */
  reply: string;
  /** お返事の絵文字 */
  replyEmoji: string;
};

export const tasks: Task[] = [
  {
    id: "greeting",
    emoji: "🧑‍🏫",
    speaker: "Teacher Tom",
    scene: "🌳",
    prompt: "Hello! How are you today?",
    promptJa: "こんにちは！きょうの きぶんは どう？",
    hintJa: "fine = げんき / good = いいかんじ / sad = かなしい",
    words: ["I", "am", "fine", "thank", "you", "good", "sad", "yes"],
    patterns: [
      {
        id: "greeting-plain",
        tokens: ["<subject>", "<be>", "<mood>"],
        slots: { subject: ["I"], be: ["am"], mood: ["fine", "good", "sad"] },
      },
      {
        id: "greeting-thanks",
        tokens: ["<subject>", "<be>", "<mood>", "thank", "you"],
        slots: { subject: ["I"], be: ["am"], mood: ["fine", "good", "sad"] },
      },
      {
        id: "greeting-thanks-first",
        tokens: ["thank", "you", "<subject>", "<be>", "<mood>"],
        slots: { subject: ["I"], be: ["am"], mood: ["fine", "good", "sad"] },
      },
    ],
    reply: "Thank you for telling me! 😊",
    replyEmoji: "🌟",
  },
  {
    id: "color",
    emoji: "🎨",
    speaker: "Ms. Rainbow",
    scene: "🖍️",
    prompt: "What is your favorite color?",
    promptJa: "すきな いろは なに？",
    hintJa: "favorite = おきにいりの / color = いろ",
    words: ["My", "favorite", "color", "is", "blue", "red", "green", "the"],
    patterns: [
      {
        id: "color-mine",
        tokens: ["<poss>", "favorite", "color", "is", "<color>"],
        slots: { poss: ["My"], color: ["blue", "red", "green"] },
      },
      {
        id: "color-first",
        tokens: ["<color>", "is", "<poss>", "favorite", "color"],
        slots: { poss: ["My"], color: ["blue", "red", "green"] },
      },
    ],
    reply: "That's a lovely color! 🎨",
    replyEmoji: "🌈",
  },
  {
    id: "food",
    emoji: "👩‍🍳",
    speaker: "Chef Mia",
    scene: "🍳",
    prompt: "What food do you like?",
    promptJa: "すきな たべものは なに？",
    hintJa: "I like to eat ... = わたしは ...を たべるのが すき",
    words: ["I", "like", "to", "eat", "pizza", "pasta", "cake", "rice", "the"],
    patterns: [
      {
        id: "food-like-to-eat",
        tokens: ["<subject>", "like", "to", "eat", "<food>"],
        slots: {
          subject: ["I"],
          food: ["pizza", "pasta", "cake", "rice"],
        },
      },
      {
        id: "food-like",
        tokens: ["<subject>", "like", "<food>"],
        slots: { subject: ["I"], food: ["pizza", "pasta", "cake", "rice"] },
      },
    ],
    reply: "Yummy! That sounds delicious! 🍽️",
    replyEmoji: "🍕",
  },
  {
    id: "pet",
    emoji: "👦",
    speaker: "Sam",
    scene: "🐾",
    prompt: "Do you have a pet?",
    promptJa: "ペットを かっている？",
    hintJa: "I have a ... = わたしは ...を かっている / an は 母音のまえ",
    words: [
      "I",
      "have",
      "a",
      "an",
      "cat",
      "dog",
      "rabbit",
      "small",
      "big",
      "white",
    ],
    patterns: [
      {
        id: "pet-simple",
        tokens: ["<subject>", "have", "<article>", "<animal>"],
        slots: {
          subject: ["I"],
          article: ["a", "an"],
          animal: ["cat", "dog", "rabbit"],
        },
      },
      {
        id: "pet-with-adjective",
        tokens: ["<subject>", "have", "<article>", "<adj>", "<animal>"],
        slots: {
          subject: ["I"],
          article: ["a", "an"],
          adj: ["small", "big", "white"],
          animal: ["cat", "dog", "rabbit"],
        },
      },
    ],
    reply: "Aww! I love animals! 🐶",
    replyEmoji: "💛",
  },
  {
    id: "can",
    emoji: "🏊",
    speaker: "Coach Ken",
    scene: "🏫",
    prompt: "Can you swim?",
    promptJa: "およげる？",
    hintJa: "Yes I can ... = はい、できます / No I cannot ... = いいえ、できません",
    words: [
      "Yes",
      "No",
      "I",
      "can",
      "cannot",
      "swim",
      "sing",
      "run",
      "jump",
    ],
    patterns: [
      {
        id: "can-yes",
        tokens: ["yes", "<subject>", "can", "<verb>"],
        slots: {
          subject: ["I"],
          verb: ["swim", "sing", "run", "jump"],
        },
      },
      {
        id: "can-no",
        tokens: ["no", "<subject>", "cannot", "<verb>"],
        slots: { subject: ["I"], verb: ["swim", "sing", "run", "jump"] },
      },
      {
        id: "can-plain",
        tokens: ["<subject>", "can", "<verb>"],
        slots: { subject: ["I"], verb: ["swim", "sing", "run", "jump"] },
      },
      {
        id: "can-cannot-plain",
        tokens: ["<subject>", "cannot", "<verb>"],
        slots: { subject: ["I"], verb: ["swim", "sing", "run", "jump"] },
      },
      {
        id: "can-short-yes",
        tokens: ["yes", "<subject>", "can"],
        slots: { subject: ["I"] },
      },
      {
        id: "can-short-no",
        tokens: ["no", "<subject>", "cannot"],
        slots: { subject: ["I"] },
      },
    ],
    reply: "Great! Practice makes perfect! 🏊",
    replyEmoji: "🎉",
  },
  {
    id: "weather",
    emoji: "🧒",
    speaker: "Lily",
    scene: "🌤️",
    prompt: "How is the weather today?",
    promptJa: "きょうの てんきは どう？",
    hintJa: "sunny = はれ / rainy = あめ / cloudy = くもり",
    words: ["It", "is", "sunny", "rainy", "cloudy", "hot", "cold", "today"],
    patterns: [
      {
        id: "weather-plain",
        tokens: ["<subject>", "is", "<weather>"],
        slots: {
          subject: ["It"],
          weather: ["sunny", "rainy", "cloudy", "hot", "cold"],
        },
      },
      {
        id: "weather-today",
        tokens: ["<subject>", "is", "<weather>", "today"],
        slots: {
          subject: ["It"],
          weather: ["sunny", "rainy", "cloudy", "hot", "cold"],
        },
      },
    ],
    reply: "Thanks! Let's go outside! ☀️",
    replyEmoji: "🌞",
  },
  {
    id: "family",
    emoji: "👵",
    speaker: "Grandma Rose",
    scene: "🏡",
    prompt: "How many people are in your family?",
    promptJa: "かぞくは なんにん いるの？",
    hintJa: "There are ... people in my family = かぞくは ...にんです",
    words: [
      "There",
      "are",
      "three",
      "four",
      "five",
      "people",
      "in",
      "my",
      "family",
    ],
    patterns: [
      {
        id: "family-there-are",
        tokens: [
          "there",
          "are",
          "<num>",
          "people",
          "in",
          "<poss>",
          "family",
        ],
        slots: { num: ["three", "four", "five"], poss: ["my"] },
      },
    ],
    reply: "That's a lovely family! 👨‍👩‍👧‍👦",
    replyEmoji: "💐",
  },
  {
    id: "sunday",
    emoji: "🧑",
    speaker: "Uncle Joe",
    scene: "📅",
    prompt: "What do you like to do on Sunday?",
    promptJa: "にちようびは なにを するのが すき？",
    hintJa: "play soccer = サッカー / read books = 読書 / watch TV = テレビ",
    words: [
      "I",
      "like",
      "to",
      "play",
      "read",
      "watch",
      "soccer",
      "books",
      "TV",
      "the",
    ],
    patterns: [
      {
        id: "sunday-like-to",
        tokens: ["<subject>", "like", "to", "<activity>"],
        slots: {
          subject: ["I"],
          activity: [
            ["play", "soccer"],
            ["read", "books"],
            ["watch", "TV"],
          ],
        },
      },
    ],
    reply: "That sounds like fun! 🎉",
    replyEmoji: "🎈",
  },
  {
    id: "shop",
    emoji: "🧑‍🌾",
    speaker: "Shopkeeper Ann",
    scene: "🛒",
    prompt: "You want one apple. What do you say?",
    promptJa: "りんごを 1つ ください。なんて いう？",
    hintJa: "Can I have ...? = ...を もらえますか / an は 母音のまえ",
    words: [
      "Can",
      "I",
      "have",
      "an",
      "apple",
      "orange",
      "please",
      "a",
      "the",
    ],
    patterns: [
      {
        id: "shop-request",
        tokens: ["can", "<subject>", "have", "<article>", "<item>"],
        slots: {
          subject: ["I"],
          article: ["a", "an", "the"],
          item: ["apple", "orange"],
        },
      },
      {
        id: "shop-request-please",
        tokens: [
          "can",
          "<subject>",
          "have",
          "<article>",
          "<item>",
          "please",
        ],
        slots: {
          subject: ["I"],
          article: ["a", "an", "the"],
          item: ["apple", "orange"],
        },
      },
    ],
    reply: "Sure! Here you are. 🍎",
    replyEmoji: "🛍️",
  },
  {
    id: "station",
    emoji: "🧑‍💼",
    speaker: "A Tourist",
    scene: "🗾",
    prompt: "Excuse me. Where is the station?",
    promptJa: "すみません。えきは どこですか？",
    hintJa: "go straight = まっすぐ / turn left = ひだりへ / at the corner = かどで",
    words: [
      "Go",
      "straight",
      "and",
      "turn",
      "left",
      "right",
      "at",
      "the",
      "corner",
      "please",
    ],
    patterns: [
      {
        id: "station-directions",
        tokens: ["go", "straight", "and", "turn", "<dir>", "at", "the", "corner"],
        slots: { dir: ["left", "right"] },
      },
      {
        id: "station-directions-please",
        tokens: [
          "go",
          "straight",
          "and",
          "turn",
          "<dir>",
          "at",
          "the",
          "corner",
          "please",
        ],
        slots: { dir: ["left", "right"] },
      },
    ],
    reply: "Thank you so much! 🗾",
    replyEmoji: "🙏",
  },
];

/* ------------------------------------------------------------------ *
 * 判定
 * ------------------------------------------------------------------ */

export type AnswerVerdict =
  | "correct" // 文法的に正しく、質問への返事としても通る
  | "grammar" // 文型は合っているが文法ルール違反（a/an、主語と be の不一致）
  | "wrong-order" // 使う単語は合っているが語順が違う
  | "wrong-words"; // 使う単語の選び方が違う

export type Judgment = {
  verdict: AnswerVerdict;
  /** 子供に見せる補足（文法エラーの説明など） */
  detail?: string;
  /** 一致した文法パターン（デバッグ用） */
  patternId?: string;
};

/**
 * こたえを判定する。
 * 文法パターンに合致し、かつ文法ルール（主語と be の一致 / a・an）を満たせば正解。
 */
export function judgeAnswer(task: Task, answer: string[]): Judgment {
  const checker = new GrammarChecker(task.patterns);
  const result = checker.check(answer);

  if (result.ok) return { verdict: "correct", patternId: result.patternId };

  if (result.issue) {
    return { verdict: "grammar", detail: result.issue.message };
  }

  const orderHint = checker.findOrderHint(answer);
  if (orderHint) return { verdict: "wrong-order" };

  return { verdict: "wrong-words" };
}
