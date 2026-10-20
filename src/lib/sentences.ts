/**
 * 単語並べ替え（文章作成）機能のデータ — issue #10
 *
 * 設計方針:
 * - 1タスク = 「相手の発言（質問/会話）」+「単語カード 5〜10枚」+「正解の語順（複数可）」+「正解時のお返事」
 * - カードにはダミー（distractor）を混ぜる。使わないカードがあってよい。
 * - 正解は1つではない。文法が正しく、相手の発言に対して意味が通れば正解。
 *   → `accepts` に語順違い・言い換えを複数並べる。語彙の言い換えは `words` に語を足して表現する。
 * - 比較は大文字小文字と句読点を無視する（`normalizeWord`）。
 */

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
  /** 正解の語順（複数可） */
  accepts: string[][];
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
    hintJa: "fine = げんき / thank you = ありがとう",
    words: ["I", "am", "fine", "thank", "you", "good", "sad", "yes"],
    accepts: [
      ["I", "am", "fine", "thank", "you"],
      ["I", "am", "good", "thank", "you"],
    ],
    reply: "Wonderful! I'm so happy! 😊",
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
    accepts: [
      ["My", "favorite", "color", "is", "blue"],
      ["My", "favorite", "color", "is", "red"],
      ["My", "favorite", "color", "is", "green"],
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
    accepts: [
      ["I", "like", "to", "eat", "pizza"],
      ["I", "like", "to", "eat", "pasta"],
      ["I", "like", "to", "eat", "cake"],
      ["I", "like", "to", "eat", "rice"],
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
    hintJa: "I have a ... = わたしは ...を かっている",
    words: [
      "I",
      "have",
      "a",
      "cat",
      "dog",
      "rabbit",
      "small",
      "big",
      "white",
    ],
    accepts: [
      ["I", "have", "a", "cat"],
      ["I", "have", "a", "dog"],
      ["I", "have", "a", "rabbit"],
      ["I", "have", "a", "small", "cat"],
      ["I", "have", "a", "big", "dog"],
      ["I", "have", "a", "white", "rabbit"],
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
    hintJa: "Yes, I can ... = はい、できます / No, I cannot ... = いいえ、できません",
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
    accepts: [
      ["Yes", "I", "can", "swim"],
      ["No", "I", "cannot", "swim"],
      ["Yes", "I", "can", "sing"],
      ["Yes", "I", "can", "run"],
      ["Yes", "I", "can", "jump"],
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
    accepts: [
      ["It", "is", "sunny"],
      ["It", "is", "rainy"],
      ["It", "is", "cloudy"],
      ["It", "is", "hot"],
      ["It", "is", "cold"],
      ["It", "is", "hot", "today"],
      ["It", "is", "cold", "today"],
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
    accepts: [
      ["There", "are", "three", "people", "in", "my", "family"],
      ["There", "are", "four", "people", "in", "my", "family"],
      ["There", "are", "five", "people", "in", "my", "family"],
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
    accepts: [
      ["I", "like", "to", "play", "soccer"],
      ["I", "like", "to", "read", "books"],
      ["I", "like", "to", "watch", "TV"],
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
    hintJa: "Can I have ...? = ...を もらえますか / please = おねがいします",
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
    accepts: [
      ["Can", "I", "have", "an", "apple", "please"],
      ["Can", "I", "have", "an", "apple"],
      ["Can", "I", "have", "an", "orange", "please"],
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
    accepts: [
      ["Go", "straight", "and", "turn", "left", "at", "the", "corner"],
      ["Go", "straight", "and", "turn", "right", "at", "the", "corner"],
    ],
    reply: "Thank you so much! 🗾",
    replyEmoji: "🙏",
  },
];

/** 大文字小文字・句読点を無視して比較するための正規化 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

export type CheckResult = "correct" | "wrong-order" | "wrong-words";

/** 語の多重集合が一致するか（順序は無視） */
function sameWords(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((w, i) => w === sortedB[i]);
}

/**
 * こたえを判定する。
 * - correct: 正解の語順のどれかと一致
 * - wrong-order: 使った単語は合っているが、順序が違う
 * - wrong-words: 単語の選び方そのものが違う
 */
export function checkAnswer(task: Task, answer: string[]): CheckResult {
  const attempt = answer.map(normalizeWord);
  for (const accept of task.accepts) {
    const target = accept.map(normalizeWord);
    if (
      target.length === attempt.length &&
      target.every((w, i) => w === attempt[i])
    ) {
      return "correct";
    }
  }
  for (const accept of task.accepts) {
    if (sameWords(accept.map(normalizeWord), attempt)) return "wrong-order";
  }
  return "wrong-words";
}
