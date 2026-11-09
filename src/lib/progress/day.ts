/**
 * 日本時間の日付 — issue #4 (進捗管理) の土台
 *
 * 「きょう学習した」の判定は **必ず JST** で行う。
 * `new Date().toISOString().slice(0, 10)` は UTC なので、日本では 09:00 までが
 * 「昨日」になる。子どもが朝 7 時にやった学習が前日扱いになると、ストリークも
 * 日次グラフも静かにずれる (しかもテストが UTC 環境だと気づけない)。
 *
 * この関数は **依存を持たない** (`node --test` の型ストリッピングで直接 import したい)。
 */

/** タイムゾーンは 1 か所に固定する */
export const APP_TIME_ZONE = "Asia/Tokyo";

/** 日本時間の `YYYY-MM-DD` */
export function dayKeyOf(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** いまの日本時間の日付 */
export function todayKey(): string {
  return dayKeyOf(new Date());
}

/** `YYYY-MM-DD` を日付の数値に直す (辞書順でも比較できるが、差分計算用) */
export function dayKeyToUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** `from` から `to` まで何日離れているか (同じ日なら 0) */
export function daysBetween(from: string, to: string): number {
  const ms = dayKeyToUtcDate(to).getTime() - dayKeyToUtcDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * `day` の `delta` 日後 (負なら前) のキー。連続日数を数えるときに使う。
 *
 * ここで `toISOString().slice(0, 10)` を使うのは **日付キーの計算** だから。
 * 「いま何日か」をこれで取ってはいけない (UTC で切ると JST 09:00 前にずれる)。
 * `dayKeyToUtcDate()` が返すのは UTC の 0 時なので、日単位の加減算はそのまま安全。
 */
export function addDays(day: string, delta: number): string {
  const base = dayKeyToUtcDate(day).getTime();
  return new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
}
