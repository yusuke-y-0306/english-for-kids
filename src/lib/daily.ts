import { categories, type Word } from "./words";

/**
 * ユーザーごとの「きょうの カード」を決める。
 * seed = ユーザーID + 日付 なので、同じ日でも人によって違う単語になる。
 */

function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 日本時間の YYYY-MM-DD */
export function todayInTokyo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type DailyWord = {
  word: Word;
  categoryLabel: string;
  categoryEmoji: string;
};

export function pickDailyWord(userId: string, day: string = todayInTokyo()): DailyWord {
  const all: DailyWord[] = categories.flatMap((category) =>
    category.words.map((word) => ({
      word,
      categoryLabel: category.label,
      categoryEmoji: category.emoji,
    })),
  );
  const index = hash(`${userId}:${day}`) % all.length;
  return all[index];
}
