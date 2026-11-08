/**
 * 連続学習日数 (ストリーク) — issue #69 の判定部分
 *
 * 「今日もやった」の手応えは、子どもにとって数字より大事。だから判定は
 * **依存を持たない純粋関数** にして、日付跨ぎ・抜け・月跨ぎ・年跨ぎを
 * `node --test` で直接固定できるようにする (fs も `next/headers` も触らない)。
 *
 * ## 決めた仕様 (#69 の提案どおり)
 *
 * - 日付は **JST** (`dayKeyOf()` で作った `YYYY-MM-DD`)。UTC で判定すると
 *   朝 9 時前に日付が変わり、子どもの朝練が前日扱いになる
 * - **今日まだでも、昨日まで続いていれば `current` は維持** する。
 *   朝いきなり 0 に戻して子を悲しませないため。`studiedToday: false` で
 *   「きょうも やろう」を出せる
 * - **2 日以上空いたら `current = 0`** (昨日も一昨日もやっていない)
 * - 未来の日付キーは **無視** する (端末の時計が進んでいても streak が壊れない)
 *
 * `longest` は日次データ (最大 400 日) から数え直した値。保存済みの
 * `progress.longestStreak` は保持期間より前の記録を持っていることがあるので、
 * **呼び出し側で `Math.max(保存値, 計算値)` を取る** (この関数は計算だけを返す)。
 */

/** 日次データのうち、streak の判定に必要な部分だけ (ProgressDay がそのまま渡せる) */
export type StreakDayLike = {
  quiz?: { rounds?: number } | undefined;
  pronunciation?: { attempts?: number } | undefined;
};

export type StreakDays = Record<string, StreakDayLike | null | undefined>;

export type Streak = {
  /** いまの連続日数 (今日まだでも昨日まで続いていれば維持) */
  current: number;
  /** 日次から数え直した最長連続日数 */
  longest: number;
  /** 今日もう学習したか */
  studiedToday: boolean;
  /** 最後に学習した日 (`YYYY-MM-DD`)。まだ無ければ null */
  lastStudyDay: string | null;
};

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * `day` の `delta` 日後 (負なら前)。
 *
 * `day.ts` の `addDays()` と同じ計算だが、この層は **import を持たない** ので
 * 自前で持つ (純粋関数を `node --test` の型ストリッピングで直接 import するため。
 * `state.ts` / `day.ts` と同じ流儀)。日付キーは UTC 0 時なので日単位の加減算は安全。
 */
function shiftDay(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * その日に「学習した」と数えるか。
 *
 * クイズを 1 ラウンドでも遊んだ、または発音を 1 回でも試したら学習した日。
 * 画面を開いただけ (`visits`) では数えない。
 */
export function isStudiedDay(entry: StreakDayLike | null | undefined): boolean {
  if (!entry || typeof entry !== "object") return false;
  const rounds = Number(entry.quiz?.rounds ?? 0);
  const attempts = Number(entry.pronunciation?.attempts ?? 0);
  return (Number.isFinite(rounds) && rounds > 0) || (Number.isFinite(attempts) && attempts > 0);
}

/** 学習した日を古い順に返す (未来日と壊れたキーは落とす) */
export function studiedDaysUpTo(days: StreakDays, today: string): string[] {
  const studied: string[] = [];
  for (const [day, entry] of Object.entries(days ?? {})) {
    if (!DAY_KEY_PATTERN.test(day)) continue;
    if (day > today) continue;
    if (!isStudiedDay(entry)) continue;
    studied.push(day);
  }
  return studied.sort();
}

/**
 * 連続日数を数える。
 *
 * `today` は呼び出し側が `dayKeyOf()` で作った JST の今日を渡すこと
 * (ここで `new Date()` を呼ぶとテストで境界を固定できない)。
 */
export function streakOf(days: StreakDays, today: string): Streak {
  if (!DAY_KEY_PATTERN.test(today)) {
    /* 壊れた today で無限ループに入るより、空として返す方が安全 */
    return { current: 0, longest: 0, studiedToday: false, lastStudyDay: null };
  }

  const studied = new Set(studiedDaysUpTo(days, today));
  const studiedToday = studied.has(today);

  /* 今日まだなら昨日を起点にする (昨日まで続いていれば維持) */
  let current = 0;
  let cursor = studiedToday ? today : shiftDay(today, -1);
  while (studied.has(cursor)) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }

  /* 最長は素直に走査する (日次は 400 日で切られているので十分速い) */
  const ordered = [...studied].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of ordered) {
    run = previous !== null && shiftDay(previous, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }
  if (current > longest) longest = current;

  return {
    current,
    longest,
    studiedToday,
    lastStudyDay: ordered.length > 0 ? ordered[ordered.length - 1] : null,
  };
}
