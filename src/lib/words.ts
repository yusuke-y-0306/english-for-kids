export type Word = {
  en: string;
  ja: string;
  emoji: string;
  /**
   * 同じ音で綴りが違う語。認識器は音を文字に落とすので、これらが返ってきても正解にする
   * (two → "too" / eye → "I")。採点は `scorePronunciation()` の `homophones` に渡す。
   */
  homophones?: string[];
  /** 意味は同じだが別の語 (mother → "mom")。お手本の語ではないので `ok` にはせず `close` 止まり */
  variants?: string[];
};

export type Category = {
  id: string;
  label: string;
  emoji: string;
  /** Tailwind gradient classes for the card front */
  color: string;
  words: Word[];
};

export const categories: Category[] = [
  {
    id: "animals",
    label: "動物",
    emoji: "🐾",
    color: "from-amber-300 to-orange-400",
    words: [
      { en: "dog", ja: "いぬ", emoji: "🐶" },
      { en: "cat", ja: "ねこ", emoji: "🐱" },
      { en: "bird", ja: "とり", emoji: "🐦" },
      { en: "fish", ja: "さかな", emoji: "🐟" },
      { en: "lion", ja: "ライオン", emoji: "🦁" },
      { en: "elephant", ja: "ぞう", emoji: "🐘" },
      { en: "rabbit", ja: "うさぎ", emoji: "🐰" },
      { en: "bear", ja: "くま", emoji: "🐻" },
    ],
  },
  {
    id: "food",
    label: "たべもの",
    emoji: "🍎",
    color: "from-rose-300 to-red-400",
    words: [
      { en: "apple", ja: "りんご", emoji: "🍎" },
      { en: "banana", ja: "バナナ", emoji: "🍌" },
      { en: "bread", ja: "パン", emoji: "🍞", homophones: ["bred"] },
      { en: "milk", ja: "ぎゅうにゅう", emoji: "🥛" },
      { en: "rice", ja: "ごはん", emoji: "🍚" },
      { en: "egg", ja: "たまご", emoji: "🥚" },
      { en: "cake", ja: "ケーキ", emoji: "🍰" },
      { en: "water", ja: "みず", emoji: "💧" },
    ],
  },
  {
    id: "colors",
    label: "いろ",
    emoji: "🎨",
    color: "from-fuchsia-300 to-purple-400",
    words: [
      { en: "red", ja: "あか", emoji: "🔴", homophones: ["read"] },
      { en: "blue", ja: "あお", emoji: "🔵", homophones: ["blew"] },
      { en: "yellow", ja: "きいろ", emoji: "🟡" },
      { en: "green", ja: "みどり", emoji: "🟢" },
      { en: "black", ja: "くろ", emoji: "⚫" },
      { en: "white", ja: "しろ", emoji: "⚪" },
      { en: "pink", ja: "ピンク", emoji: "🌸" },
      { en: "orange", ja: "オレンジ", emoji: "🟠" },
    ],
  },
  {
    id: "numbers",
    label: "すうじ",
    emoji: "🔢",
    color: "from-sky-300 to-blue-400",
    words: [
      { en: "one", ja: "1", emoji: "1️⃣", homophones: ["won"] },
      { en: "two", ja: "2", emoji: "2️⃣", homophones: ["too", "to"] },
      { en: "three", ja: "3", emoji: "3️⃣" },
      { en: "four", ja: "4", emoji: "4️⃣", homophones: ["for", "fore"] },
      { en: "five", ja: "5", emoji: "5️⃣" },
      { en: "six", ja: "6", emoji: "6️⃣" },
      { en: "seven", ja: "7", emoji: "7️⃣" },
      { en: "eight", ja: "8", emoji: "8️⃣", homophones: ["ate"] },
    ],
  },
  {
    id: "body",
    label: "からだ",
    emoji: "🖐️",
    color: "from-emerald-300 to-teal-400",
    words: [
      { en: "head", ja: "あたま", emoji: "🗣️" },
      { en: "eye", ja: "め", emoji: "👁️", homophones: ["i"] },
      { en: "ear", ja: "みみ", emoji: "👂" },
      { en: "nose", ja: "はな", emoji: "👃", homophones: ["knows"] },
      { en: "mouth", ja: "くち", emoji: "👄" },
      { en: "hand", ja: "て", emoji: "✋" },
      { en: "foot", ja: "あし", emoji: "🦶" },
      { en: "hair", ja: "かみ", emoji: "💇", homophones: ["hare"] },
    ],
  },
  {
    id: "family",
    label: "かぞく",
    emoji: "👨‍👩‍👧",
    color: "from-indigo-300 to-violet-400",
    words: [
      { en: "mother", ja: "おかあさん", emoji: "👩", variants: ["mom", "mum", "mommy"] },
      { en: "father", ja: "おとうさん", emoji: "👨", variants: ["dad", "papa", "daddy"] },
      { en: "sister", ja: "おねえさん", emoji: "👧" },
      { en: "brother", ja: "おにいさん", emoji: "👦" },
      { en: "grandmother", ja: "おばあちゃん", emoji: "👵", variants: ["grandma", "grandmom"] },
      { en: "grandfather", ja: "おじいちゃん", emoji: "👴", variants: ["grandpa", "granddad"] },
      { en: "baby", ja: "あかちゃん", emoji: "👶" },
      { en: "family", ja: "かぞく", emoji: "👨‍👩‍👧‍👦" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 単語 ID (issue #32)                                                 */
/* ------------------------------------------------------------------ */

/**
 * 単語の安定した ID。`<categoryId>/<en>` 形式 (例: `animals/dog`)。
 *
 * 外部から ID を受け取る経路 (発音結果の保存など) では、
 * **この形式で `findWordById()` が引けるものだけ**を受理する。
 * 配列の添字や表示名を ID にしないこと (並び替えや文言修正で壊れる)。
 */
export function wordId(categoryId: string, word: Word): string {
  return `${categoryId}/${word.en}`;
}

export type IdentifiedWord = {
  id: string;
  categoryId: string;
  word: Word;
};

const WORDS_BY_ID: ReadonlyMap<string, IdentifiedWord> = new Map(
  categories.flatMap((category) =>
    category.words.map((word): [string, IdentifiedWord] => [
      wordId(category.id, word),
      { id: wordId(category.id, word), categoryId: category.id, word },
    ]),
  ),
);

/** ID から単語を引く。無ければ null (ホワイトリストとして使う) */
export function findWordById(id: string): IdentifiedWord | null {
  return WORDS_BY_ID.get(id) ?? null;
}

/** 存在する単語 ID の一覧 */
export function allWordIds(): string[] {
  return [...WORDS_BY_ID.keys()];
}
