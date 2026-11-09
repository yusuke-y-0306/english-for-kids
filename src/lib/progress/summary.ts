/**
 * 進捗の集計 — issue #67 (親: #4 進捗管理)
 *
 * 記録した数字を「達成度の可視化」に変える層。**依存を持たない純粋な世界**
 * (fs も `next/headers` も触らない) にしてあるので、`node --test` で境界
 * (0 件・歯抜け・月跨ぎ・年跨ぎ) を直接固定できる。画面 (#68) を作り直しても
 * 数字がぶれないのは、数字の作り方がここ 1 か所しかないから。
 *
 * 入力は `progress` の状態、発音の単語別状態 (`data.pronunciation.byWord`)、
 * そして **単語の一覧 (`words.ts`)**。一覧を引数で受け取るのは、この層を
 * import 無しに保つため (`state.ts` / `day.ts` / `streak.ts` と同じ流儀)。
 * 並び順は渡された順 = `words.ts` の並びになる。
 *
 * 発音の単語別を進捗側に持たないのは #66 の分担 (同じ事実を 2 か所で持たない)。
 * 累計の正は `pronunciation.totalAttempts`、日次は `progress.days`。
 */

/* ------------------------------------------------------------------ */
/* 日次の系列                                                          */
/* ------------------------------------------------------------------ */

/** 既定で返す日数 (直近 1 週間) */
export const DAILY_SERIES_DEFAULT_DAYS = 7;
/** 画面が欲しがってもいい上限。これ以上は 1 リクエストで返さない */
export const DAILY_SERIES_MAX_DAYS = 90;
export const DAILY_SERIES_MIN_DAYS = 1;

/**
 * `?days=` を 1〜90 に丸める。**不正値は 400 にせず既定に落とす**
 * (URL をいじっただけで画面がエラーになるより、7 日を出す方が親切)。
 */
export function clampDayCount(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DAILY_SERIES_DEFAULT_DAYS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DAILY_SERIES_DEFAULT_DAYS;
  const whole = Math.trunc(value);
  return Math.min(DAILY_SERIES_MAX_DAYS, Math.max(DAILY_SERIES_MIN_DAYS, whole));
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * `day` の `delta` 日後 (負なら前)。`day.ts` の `addDays()` と同じ計算だが、
 * この層は import を持たないので自前で持つ (理由はファイル冒頭)。
 */
function shiftDay(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日次データのうち集計に必要な部分 (ProgressDay がそのまま渡せる) */
export type DayLike = {
  quiz?: { rounds?: number; correct?: number; total?: number } | undefined;
  pronunciation?: { attempts?: number; ok?: number } | undefined;
};

export type DayMap = Record<string, DayLike | null | undefined>;

/** 単語別の正誤 (progress 側が正) */
export type WordLike = { correct?: number; wrong?: number; lastAt?: string } | undefined;

/** 発音の単語別状態のうち、判定に必要な部分 (pronunciation 側が正) */
export type PronunciationWordLike = {
  score?: string;
  attempts?: number;
  /** 最終挑戦日時 (ISO 8601)。あれば `lastAt` の比較に使う */
  updatedAt?: string;
} | undefined;

/** 集計の入力。「どこに何が正か」を型で示す */
export type ProgressInput = {
  days: DayMap;
  words: Record<string, WordLike>;
  /** `data.pronunciation.byWord` */
  pronunciation?: Record<string, PronunciationWordLike>;
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type DailySlice = {
  /** `YYYY-MM-DD` (JST) */
  day: string;
  quiz: {
    rounds: number;
    correct: number;
    total: number;
    /** 正答率 (0〜100 の整数 %)。出題が 0 なら 0 */
    accuracy: number;
  };
  pronunciation: { attempts: number; ok: number };
  /** その日に何かしら学習したか (グラフの棒を出すかの判定) */
  studied: boolean;
};

function sliceOf(input: ProgressInput, day: string): DailySlice {
  const entry = input.days[day];
  const rounds = num(entry?.quiz?.rounds);
  const correct = Math.min(num(entry?.quiz?.correct), num(entry?.quiz?.total));
  const total = num(entry?.quiz?.total);
  const attempts = num(entry?.pronunciation?.attempts);
  const ok = Math.min(num(entry?.pronunciation?.ok), attempts);
  return {
    day,
    quiz: {
      rounds,
      correct,
      total,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    },
    pronunciation: { attempts, ok },
    studied: rounds > 0 || attempts > 0,
  };
}

/**
 * 直近 `days` 日ぶんの系列を **古い順** に返す (最後の要素が `today`)。
 *
 * - 学習していない日は **0 で埋める** (歯抜けを作らない。グラフの棒がずれない)
 * - 月跨ぎ・年跨ぎ・閏年は日付キーの加減算に任せる (自前で 31 日を数えない)
 */
export function summarizeDaily(
  input: ProgressInput,
  options: { days?: unknown; today: string },
): DailySlice[] {
  if (!DAY_KEY_PATTERN.test(options.today)) return [];
  const count = clampDayCount(options.days);
  const series: DailySlice[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    series.push(sliceOf(input, shiftDay(options.today, -offset)));
  }
  return series;
}

/* ------------------------------------------------------------------ */
/* 単語別の習得度                                                      */
/* ------------------------------------------------------------------ */

/**
 * 習得度のしきい値。**数字はここにしか書かない** (言葉を変えたいときに
 * あちこち直さないで済む)。
 */
export const MASTERY_THRESHOLDS = {
  /** クイズでこれだけ正解したら「覚えた」 */
  correctForMastered: 3,
  /** クイズ 1 回正解 + 発音 ok でも「覚えた」 (読めて言える) */
  correctWithPronunciationOk: 1,
} as const;

/** 未 / 練習中 / 覚えた */
export type MasteryLevel = "unseen" | "learning" | "mastered";

/** 画面で出す日本語。ひらがな中心 (#68 のトーン) */
export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  unseen: "まだ",
  learning: "れんしゅうちゅう",
  mastered: "おぼえた",
};

export type WordMastery = {
  id: string;
  level: MasteryLevel;
  /** クイズの正誤 (progress 側が正) */
  correct: number;
  wrong: number;
  /** 発音 (pronunciation 側が正) */
  pronunciation: { attempts: number; ok: boolean };
  /** 最後に触った日時 (ISO 8601)。まだ無ければ null */
  lastAt: string | null;
};

/**
 * 1 語ぶんの習得度。
 *
 * - 「覚えた」= クイズで `correctForMastered` 回正解、またはクイズ 1 回正解 + 発音 ok
 * - 「練習中」= 何かしら手を付けた (クイズの正誤・発音のどれか)
 * - 「まだ」= 記録が無い
 */
export function masteryOf(
  wordId: string,
  input: ProgressInput,
): WordMastery {
  const quiz = input.words[wordId];
  const spoken = input.pronunciation?.[wordId];
  const correct = num(quiz?.correct);
  const wrong = num(quiz?.wrong);
  const attempts = num(spoken?.attempts);
  const spokenOk = attempts > 0 && spoken?.score === "ok";

  const level: MasteryLevel =
    correct >= MASTERY_THRESHOLDS.correctForMastered ||
    (correct >= MASTERY_THRESHOLDS.correctWithPronunciationOk && spokenOk)
      ? "mastered"
      : correct > 0 || wrong > 0 || attempts > 0
        ? "learning"
        : "unseen";

  /* lastAt はクイズと発音の新しい方。ISO 8601 は辞書順 = 時系列なので文字列比較でよい */
  const lastAt =
    [quiz?.lastAt, spoken?.updatedAt]
      .filter((value): value is string => typeof value === "string" && value !== "")
      .sort()
      .pop() ?? null;

  return {
    id: wordId,
    level,
    correct,
    wrong,
    pronunciation: { attempts, ok: spokenOk },
    lastAt,
  };
}

/**
 * 手を付けた単語だけを、渡された順 (`words.ts` の並び) で返す。
 *
 * 全 48 語を毎回返すと payload が膨らむので、記録のある単語だけ。
 * 「まだ」の語数は `summarizeCategories()` が数える (画面はそれで足りる)。
 */
export function summarizeWords(
  input: ProgressInput,
  wordIds: readonly string[],
): Record<string, WordMastery> {
  const result: Record<string, WordMastery> = {};
  for (const wordId of wordIds) {
    const mastery = masteryOf(wordId, input);
    if (mastery.level === "unseen") continue;
    result[wordId] = mastery;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* カテゴリ別の達成度                                                  */
/* ------------------------------------------------------------------ */

/** 集計に必要なカテゴリの形 (`words.ts` の `categories` がそのまま渡せる) */
export type CategoryLike = {
  id: string;
  label: string;
  emoji: string;
  words: ReadonlyArray<{ en: string }>;
};

export type CategoryProgress = {
  id: string;
  label: string;
  emoji: string;
  /** そのカテゴリの語数 */
  total: number;
  mastered: number;
  learning: number;
  unseen: number;
};

/**
 * `words.ts` のカテゴリごとに「何語中いくつ覚えたか」。
 *
 * 未学習のカテゴリも **必ず返す** (画面が「まだ 0 / 8」を出せるように)。
 */
export function summarizeCategories(
  input: ProgressInput,
  categories: readonly CategoryLike[],
): CategoryProgress[] {
  return categories.map((category) => {
    let mastered = 0;
    let learning = 0;
    for (const word of category.words) {
      const level = masteryOf(`${category.id}/${word.en}`, input).level;
      if (level === "mastered") mastered += 1;
      else if (level === "learning") learning += 1;
    }
    const total = category.words.length;
    return {
      id: category.id,
      label: category.label,
      emoji: category.emoji,
      total,
      mastered,
      learning,
      unseen: Math.max(0, total - mastered - learning),
    };
  });
}
