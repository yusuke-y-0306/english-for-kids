/**
 * 学習履歴の「形」と計算 — issue #4 (進捗管理)
 *
 * ここは **依存を持たない純粋な世界** にしてある (fs も `next/headers` も触らない)。
 * 理由は 2 つ:
 *  - 保存形式と丸め方を `node --test` で直接固定できる (壊れた JSON の正規化はテストが命)
 *  - 画面 (#68) や集計 (#67) が増えても、数字の作り方が 1 か所に留まる
 *
 * 保存するのは **数と日付だけ**。音声・認識テキストは保存しない (#32 の方針)。
 */

/** 1 日ぶんの学習量 */
export type ProgressDay = {
  quiz: {
    /** その日に遊んだラウンド数 */
    rounds: number;
    /** その日の正解数 (全ラウンド合計) */
    correct: number;
    /** その日の出題数 (全ラウンド合計) */
    total: number;
  };
  pronunciation: {
    /** その日に発音を試した回数 */
    attempts: number;
    /** そのうち「OK」だった回数 */
    ok: number;
  };
};

/** 単語ごとの手応え (クイズの正誤だけを数える。発音は発音ストアが正) */
export type ProgressWordState = {
  correct: number;
  wrong: number;
  /** 最後に触った日時 (ISO 8601) */
  lastAt: string;
};

export type ProgressState = {
  version: 1;
  /** `YYYY-MM-DD` (JST) → その日の学習量 */
  days: Record<string, ProgressDay>;
  /** 単語 ID → 正誤の累計 */
  words: Record<string, ProgressWordState>;
  /** 最長の連続学習日数 (#69 が更新する。ここでは保存するだけ) */
  longestStreak: number;
  /** 最後に学習した日時 (ISO 8601)。まだ無ければ null */
  lastStudyAt: string | null;
  /** この状態を最後に更新した日時 (ISO 8601) */
  updatedAt: string;
  /** 既存の発音ストアから単語別の種を蒔いた印 (#66)。二重に蒔かないため */
  migratedFromPronunciation?: true;
};

/** 日次データの保持期間。これを超えた古い日は落とす (ファイルが無限に育たない) */
export const PROGRESS_RETENTION_DAYS = 400;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function emptyDay(): ProgressDay {
  return {
    quiz: { rounds: 0, correct: 0, total: 0 },
    pronunciation: { attempts: 0, ok: 0 },
  };
}

export function emptyProgressState(): ProgressState {
  return {
    version: 1,
    days: {},
    words: {},
    longestStreak: 0,
    lastStudyAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/** 数として読める値だけを受け取り、負値は 0、小数は切り捨てる */
function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * 保存済みの値を読み直して正規化する。
 *
 * ファイルは自分たちが書いたものだが、**古い版・手編集・途中で切れた JSON** でも
 * 落ちないようにする (落ちるとその子の進捗ページが永久に開かなくなる)。
 */
export function normalizeProgressState(raw: unknown): ProgressState {
  const base = emptyProgressState();
  if (!raw || typeof raw !== "object") return base;

  const source = raw as Partial<ProgressState>;
  const days: Record<string, ProgressDay> = {};

  if (source.days && typeof source.days === "object") {
    for (const [day, value] of Object.entries(source.days)) {
      if (!DAY_KEY_PATTERN.test(day) || !value || typeof value !== "object") continue;
      const entry = value as Partial<ProgressDay>;
      const total = count(entry.quiz?.total);
      days[day] = {
        quiz: {
          rounds: count(entry.quiz?.rounds),
          /* 正解数が出題数を超えていたら出題数に丸める (表示が 120% になるのを防ぐ) */
          correct: Math.min(count(entry.quiz?.correct), total),
          total,
        },
        pronunciation: {
          attempts: count(entry.pronunciation?.attempts),
          ok: Math.min(count(entry.pronunciation?.ok), count(entry.pronunciation?.attempts)),
        },
      };
    }
  }

  const words: Record<string, ProgressWordState> = {};
  if (source.words && typeof source.words === "object") {
    for (const [wordId, value] of Object.entries(source.words)) {
      if (wordId === "" || !value || typeof value !== "object") continue;
      const entry = value as Partial<ProgressWordState>;
      words[wordId] = {
        correct: count(entry.correct),
        wrong: count(entry.wrong),
        lastAt: typeof entry.lastAt === "string" ? entry.lastAt : new Date(0).toISOString(),
      };
    }
  }

  return {
    version: 1,
    days,
    words,
    longestStreak: count(source.longestStreak),
    lastStudyAt: isoOrNull(source.lastStudyAt),
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt !== ""
        ? source.updatedAt
        : base.updatedAt,
    ...(source.migratedFromPronunciation === true ? { migratedFromPronunciation: true as const } : {}),
  };
}

/**
 * 古い日を落とす。`days` のキーは `YYYY-MM-DD` なので辞書順 = 日付順。
 * 新しい方から `keep` 件だけ残す。
 */
export function pruneDays(
  days: Record<string, ProgressDay>,
  keep: number = PROGRESS_RETENTION_DAYS,
): Record<string, ProgressDay> {
  const keys = Object.keys(days).sort();
  if (keys.length <= keep) return { ...days };
  const kept = keys.slice(keys.length - keep);
  const next: Record<string, ProgressDay> = {};
  for (const key of kept) next[key] = days[key];
  return next;
}

export type QuizRoundInput = {
  /** JST の日付 (`dayKeyOf()` で作る) */
  day: string;
  /** 1 問ぶんの結果。単語 ID は呼び出し側で存在確認済みのもの */
  results: ReadonlyArray<{ wordId: string; correct: boolean }>;
  /** 記録した日時 (ISO 8601) */
  now: string;
};

/**
 * クイズ 1 ラウンドを足した新しい状態を返す (元の状態は変更しない)。
 *
 * 出題数が 0 のラウンドは「遊んでいない」ので数えない (空送信で水増しされない)。
 */
export function applyQuizRound(state: ProgressState, input: QuizRoundInput): ProgressState {
  const total = input.results.length;
  if (total === 0) return state;

  const today = state.days[input.day] ?? emptyDay();
  const correct = input.results.filter((r) => r.correct).length;

  const words: Record<string, ProgressWordState> = { ...state.words };
  for (const result of input.results) {
    const previous = words[result.wordId] ?? {
      correct: 0,
      wrong: 0,
      lastAt: input.now,
    };
    words[result.wordId] = {
      correct: previous.correct + (result.correct ? 1 : 0),
      wrong: previous.wrong + (result.correct ? 0 : 1),
      lastAt: input.now,
    };
  }

  const days = {
    ...state.days,
    [input.day]: {
      quiz: {
        rounds: today.quiz.rounds + 1,
        correct: today.quiz.correct + correct,
        total: today.quiz.total + total,
      },
      pronunciation: { ...today.pronunciation },
    },
  };

  return {
    ...state,
    version: 1,
    days: pruneDays(days),
    words,
    lastStudyAt: input.now,
    updatedAt: input.now,
  };
}

export type PronunciationInput = {
  day: string;
  /** 判定 (ok / close / retry)。`ok` のときだけ「できた」に数える */
  ok: boolean;
  now: string;
};

/**
 * 発音 1 回ぶんを足した新しい状態を返す。
 *
 * 単語別の状態は発音ストア (`data.pronunciation`) が正なので、ここでは
 * **日次だけ** を数える (同じ事実を 2 か所で持たない)。
 */
export function applyPronunciationAttempt(
  state: ProgressState,
  input: PronunciationInput,
): ProgressState {
  const today = state.days[input.day] ?? emptyDay();
  const days = {
    ...state.days,
    [input.day]: {
      quiz: { ...today.quiz },
      pronunciation: {
        attempts: today.pronunciation.attempts + 1,
        ok: today.pronunciation.ok + (input.ok ? 1 : 0),
      },
    },
  };

  return {
    ...state,
    version: 1,
    days: pruneDays(days),
    lastStudyAt: input.now,
    updatedAt: input.now,
  };
}
