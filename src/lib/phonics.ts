/**
 * フォニックスの問題づくり — issue #88
 *
 * 画面 (`/phonics`) から使う純粋な関数だけを置く。**import を持たない**
 * (`summary.ts` / `streak.ts` と同じ流儀) ので、`node --test` の型ストリッピングで
 * 直接 import して境界を固定できる。
 *
 * 乱数は引数で受け取る (`random`)。テストで並びを固定できるようにするため。
 */

export const PHONICS_ROUND_SIZE = 8;

/** この層が知っている単語の最小形 (`words.ts` の `Word` がそのまま渡せる) */
export type PhonicsWord = {
  id: string;
  en: string;
  ja: string;
  emoji: string;
  audio?: string | null;
  /** 読み上げ用テキスト (フォニーム音)。無ければ `en` */
  tts?: string;
};

export type Random = () => number;

const DEFAULT_RANDOM: Random = Math.random;

/** Fisher–Yates。`random` を差し替えられるようにしてある (テスト用) */
export function shuffle<T>(items: readonly T[], random: Random = DEFAULT_RANDOM): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 語の頭文字 (小文字)。英字でなければ空文字。
 *
 * フォニックスの代表語は必ず英小文字で始まる前提だが、データが増えたときに
 * 落ちないよう「取れなければ空文字」にしてある。
 */
export function initialOf(en: string): string {
  const first = en.trim().charAt(0).toLowerCase();
  return /^[a-z]$/.test(first) ? first : "";
}

/** word family のカテゴリ ID (`word-family-at`) から綴りの型 (`at`) を取り出す */
export function familySuffix(categoryId: string): string {
  return categoryId.startsWith("word-family-")
    ? categoryId.slice("word-family-".length)
    : categoryId;
}

/** 語が属するカテゴリ ID (word family の判定に使う) */
export function categoryOf(wordId: string): string {
  return wordId.split("/")[0] ?? "";
}

/** 正解 1 つ + ダミー。`excluded` に当たるものは候補から外す */
function withDistractors<T>(
  answer: T,
  pool: readonly T[],
  count: number,
  keyOf: (item: T) => string,
  isExcluded: (item: T) => boolean,
  random: Random,
): T[] {
  const used = new Set([keyOf(answer)]);
  const distractors: T[] = [];
  for (const candidate of shuffle(pool, random)) {
    if (distractors.length >= count - 1) break;
    if (isExcluded(candidate)) continue;
    const key = keyOf(candidate);
    if (used.has(key)) continue;
    used.add(key);
    distractors.push(candidate);
  }
  return shuffle([answer, ...distractors], random);
}

/**
 * 「おとを きいて もじを えらぶ」の選択肢。
 *
 * 同じ文字を 2 つ出さない。フォニーム音は文字ごとに違うので、
 * 音を聞き分けられれば 1 つに絞れる。
 */
export function letterChoices(
  answer: PhonicsWord,
  letterPool: readonly PhonicsWord[],
  count = 4,
  random: Random = DEFAULT_RANDOM,
): PhonicsWord[] {
  return withDistractors(
    answer,
    letterPool,
    count,
    (word) => word.en.toLowerCase(),
    (word) => word.en.toLowerCase() === answer.en.toLowerCase(),
    random,
  );
}

/**
 * 「さいしょの もじを えらぶ」の選択肢。
 *
 * `answer` は文字 (phonics/a)、`target` は代表語。**同じ頭文字の語**を
 * ダミーにすると正解が 2 つに見えるので、頭文字が重ならない語だけを使う。
 */
export function initialChoices(
  answer: PhonicsWord,
  target: PhonicsWord,
  pool: readonly PhonicsWord[],
  count = 4,
  random: Random = DEFAULT_RANDOM,
): PhonicsWord[] {
  const usedInitial = new Set([initialOf(target.en)]);
  return withDistractors(
    answer,
    pool,
    count,
    (word) => word.en.toLowerCase(),
    (word) => {
      const initial = initialOf(word.en);
      if (initial === "" || usedInitial.has(initial)) return true;
      usedInitial.add(initial);
      return false;
    },
    random,
  );
}

/**
 * 「おなじ おとの ことばを あつめる」の選択肢。
 *
 * 同じ family の語をダミーに混ぜると正解が 2 つになるので、**別の family の語**
 * だけをダミーにする。
 */
export function familyChoices(
  answer: PhonicsWord,
  familyPool: readonly PhonicsWord[],
  count = 4,
  random: Random = DEFAULT_RANDOM,
): PhonicsWord[] {
  const family = categoryOf(answer.id);
  const usedEn = new Set([answer.en.toLowerCase()]);
  return withDistractors(
    answer,
    familyPool,
    count,
    (word) => `${categoryOf(word.id)}:${word.en.toLowerCase()}`,
    (word) => {
      if (categoryOf(word.id) === family) return true;
      const key = word.en.toLowerCase();
      if (usedEn.has(key)) return true;
      usedEn.add(key);
      return false;
    },
    random,
  );
}

/** 頭文字 `letter` で始まる語 (代表語の一覧から) */
export function wordsStartingWith(
  pool: readonly PhonicsWord[],
  letter: string,
): PhonicsWord[] {
  return pool.filter((word) => initialOf(word.en) === letter.toLowerCase());
}

/** 語彙から使える頭文字の一覧 (重複なし・アルファベット順) */
export function initialsOf(pool: readonly PhonicsWord[]): string[] {
  const letters = new Set<string>();
  for (const word of pool) {
    const initial = initialOf(word.en);
    if (initial) letters.add(initial);
  }
  return [...letters].sort();
}

/**
 * 1 ラウンドぶんの問題を選ぶ。
 *
 * `answers` から重複なく `size` 個を選ぶ (同じ問題を 1 ラウンドに 2 回出さない)。
 * 候補が足りないときは、足りない分だけ繰り返しを許す (画面を止めない)。
 */
export function pickRound<T>(
  answers: readonly T[],
  size: number = PHONICS_ROUND_SIZE,
  random: Random = DEFAULT_RANDOM,
): T[] {
  if (answers.length === 0) return [];
  const picked = shuffle(answers, random).slice(0, size);
  let index = 0;
  while (picked.length < size) {
    picked.push(answers[index % answers.length]);
    index += 1;
  }
  return picked;
}
