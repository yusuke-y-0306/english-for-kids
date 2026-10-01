export type Word = {
  en: string;
  ja: string;
  emoji: string;
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
      { en: "bread", ja: "パン", emoji: "🍞" },
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
      { en: "red", ja: "あか", emoji: "🔴" },
      { en: "blue", ja: "あお", emoji: "🔵" },
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
      { en: "one", ja: "1", emoji: "1️⃣" },
      { en: "two", ja: "2", emoji: "2️⃣" },
      { en: "three", ja: "3", emoji: "3️⃣" },
      { en: "four", ja: "4", emoji: "4️⃣" },
      { en: "five", ja: "5", emoji: "5️⃣" },
      { en: "six", ja: "6", emoji: "6️⃣" },
      { en: "seven", ja: "7", emoji: "7️⃣" },
      { en: "eight", ja: "8", emoji: "8️⃣" },
    ],
  },
  {
    id: "body",
    label: "からだ",
    emoji: "🖐️",
    color: "from-emerald-300 to-teal-400",
    words: [
      { en: "head", ja: "あたま", emoji: "🗣️" },
      { en: "eye", ja: "め", emoji: "👁️" },
      { en: "ear", ja: "みみ", emoji: "👂" },
      { en: "nose", ja: "はな", emoji: "👃" },
      { en: "mouth", ja: "くち", emoji: "👄" },
      { en: "hand", ja: "て", emoji: "✋" },
      { en: "foot", ja: "あし", emoji: "🦶" },
      { en: "hair", ja: "かみ", emoji: "💇" },
    ],
  },
  {
    id: "family",
    label: "かぞく",
    emoji: "👨‍👩‍👧",
    color: "from-indigo-300 to-violet-400",
    words: [
      { en: "mother", ja: "おかあさん", emoji: "👩" },
      { en: "father", ja: "おとうさん", emoji: "👨" },
      { en: "sister", ja: "おねえさん", emoji: "👧" },
      { en: "brother", ja: "おにいさん", emoji: "👦" },
      { en: "grandmother", ja: "おばあちゃん", emoji: "👵" },
      { en: "grandfather", ja: "おじいちゃん", emoji: "👴" },
      { en: "baby", ja: "あかちゃん", emoji: "👶" },
      { en: "family", ja: "かぞく", emoji: "👨‍👩‍👧‍👦" },
    ],
  },
];
