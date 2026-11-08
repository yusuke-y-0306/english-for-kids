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
  /**
   * 直近に記録したクイズの `roundId` (新しい順)。#65 の **冪等キー**。
   *
   * クイズは「リロード」「二重タップ」「オフライン復帰後の再送」で同じ結果が
   * 2 回届きうる。届いた順に数えると、がんばった子ほど数字が水増しされる。
   * そこで最後に処理した ID を覚えておき、同じ ID は **数えない**。
   * 1 件だけ覚えると「2 ラウンド前の再送」を弾けないので、直近
   * `QUIZ_ROUND_MEMORY` 件を輪のように持つ (ファイルは数百バイト増えるだけ)。
   */
  quizRoundIds: string[];
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

/** 覚えておく `roundId` の件数 (#65)。32 ラウンド = 8 問 × 32 ≈ 256 問ぶん */
export const QUIZ_ROUND_MEMORY = 32;

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
    quizRoundIds: [],
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

  /* 冪等キーも「読める文字列だけ・重複なし・上限まで」に正規化する。
     手編集で数千件入っていても、ここで切るので比較コストは増えない */
  const quizRoundIds: string[] = [];
  if (Array.isArray(source.quizRoundIds)) {
    for (const id of source.quizRoundIds) {
      if (typeof id !== "string" || id === "" || quizRoundIds.includes(id)) continue;
      quizRoundIds.push(id);
      if (quizRoundIds.length >= QUIZ_ROUND_MEMORY) break;
    }
  }

  return {
    version: 1,
    days,
    words,
    quizRoundIds,
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
  /**
   * クライアントが作る UUID。**冪等キー** (#65)。
   * 空文字 / 未指定なら冪等性は効かない (テストや保守用の逃げ道)。
   */
  roundId: string;
  /** JST の日付 (`dayKeyOf()` で作る) */
  day: string;
  /**
   * 1 問ぶんの結果。単語 ID は呼び出し側で存在確認済みのもの。
   * `null` は「単語に紐づかない問題」（中級・上級の文法問題）。
   * その場合は日次の出題数・正解数だけ数え、単語別には触らない。
   */
  results: ReadonlyArray<{ wordId: string | null; correct: boolean }>;
  /** 記録した日時 (ISO 8601) */
  now: string;
};

/** その日のクイズ集計 (API のレスポンスと画面が使う) */
export type QuizDaySummary = {
  rounds: number;
  correct: number;
  total: number;
};

/** 指定日の集計を取り出す (まだ遊んでいなければ全部 0) */
export function summaryForDay(state: ProgressState, day: string): QuizDaySummary {
  const entry = state.days[day]?.quiz;
  if (!entry) return { rounds: 0, correct: 0, total: 0 };
  return { rounds: entry.rounds, correct: entry.correct, total: entry.total };
}

/**
 * クイズ 1 ラウンドを足した新しい状態を返す (元の状態は変更しない)。
 *
 * 出題数が 0 のラウンドは「遊んでいない」ので数えない (空送信で水増しされない)。
 * 同じ `roundId` を 2 回受け取ったら **同じ状態をそのまま返す** (呼び出し側は
 * 参照が変わらないことで「書く必要が無い」と判断できる)。
 */
export function applyQuizRound(state: ProgressState, input: QuizRoundInput): ProgressState {
  const total = input.results.length;
  if (total === 0) return state;

  const roundId = typeof input.roundId === "string" ? input.roundId : "";
  if (roundId !== "" && state.quizRoundIds.includes(roundId)) return state;

  const today = state.days[input.day] ?? emptyDay();
  const correct = input.results.filter((r) => r.correct).length;

  const words: Record<string, ProgressWordState> = { ...state.words };
  for (const result of input.results) {
    /* 文法問題は単語を持たない。単語別の集計を汚さないよう読み飛ばす */
    if (!result.wordId) continue;
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
    quizRoundIds:
      roundId === ""
        ? state.quizRoundIds
        : [roundId, ...state.quizRoundIds].slice(0, QUIZ_ROUND_MEMORY),
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
 * 既存の発音ストア (#32) の単語別状態。**移行の入力にだけ**使う最小の形。
 *
 * `src/lib/speech/pronunciation-store.ts` の型を import しないのは、
 * 依存の向きを speech → progress の一方向に保つため (ここは依存ゼロの世界)。
 */
export type PronunciationSeedSource = {
  /** 直近の判定 (ok / close / retry)。`ok` だけが「正解」として数えられる */
  score: string;
  /** この単語を試した回数 */
  attempts: number;
  /** 最終挑戦日時 (ISO 8601) */
  updatedAt: string;
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

/**
 * 既存の発音ストアから **単語別の種を一度だけ** 蒔く — issue #66
 *
 * 発音 (#32) は `data.pronunciation.byWord` に単語ごとの回数と直近スコアを持っている。
 * 進捗 (#4) の `words[wordId]` はクイズの正誤しか知らないので、機能を入れる前から
 * 発音をがんばっていた子の「単語別の手応え」が空になってしまう。そこで **移行時に
 * 一度だけ** byWord から `correct / wrong` を復元する。
 *
 * 復元の限界 (仕様として受け入れる):
 *  - byWord が持つのは「回数」と「直近のスコア」だけ。過去のスコアの内訳は残っていないので、
 *    直近が `ok` なら全回を正解、それ以外なら全回を不正解として蒔く (楽観も悲観もする、
 *    一番単純で説明しやすい近似)
 *  - **日次 (`days`) は遡及できない**。いつ何回やったかは保存していないため、
 *    過去の日次は 0 のままにする (移行後の試行から数え始める)
 *
 * 二重計上を避ける約束:
 *  - `words` に既にその単語がある (＝クイズで数えている) なら **触らない**。
 *    発音の回数を足すと、同じ単語を 2 つの事実で二重に数えることになる
 *  - `migratedFromPronunciation: true` が立っていたら **何もしない** (同じ参照を返す)。
 *    2 回目の起動や再デプロイで種が増えないための印
 *
 * 累計の正はあくまで `pronunciation.totalAttempts` (発音ストア側)。日次は進捗側。
 * 集計 (#67) はこの 2 つを混ぜないこと。
 */
export function seedWordsFromPronunciation(
  state: ProgressState,
  byWord: Record<string, PronunciationSeedSource> | undefined,
  now: string,
): ProgressState {
  /* 既に蒔いた印があるなら、何度呼ばれても増やさない */
  if (state.migratedFromPronunciation === true) return state;

  const words: Record<string, ProgressWordState> = { ...state.words };

  if (byWord && typeof byWord === "object") {
    for (const [wordId, value] of Object.entries(byWord)) {
      if (wordId === "" || !value || typeof value !== "object") continue;
      /* クイズで既に数えている単語は触らない (二重計上しない) */
      if (words[wordId]) continue;
      const attempts = count(value.attempts);
      if (attempts === 0) continue;
      const correct = value.score === "ok" ? attempts : 0;
      words[wordId] = {
        correct,
        wrong: attempts - correct,
        lastAt: typeof value.updatedAt === "string" && value.updatedAt !== "" ? value.updatedAt : now,
      };
    }
  }

  return {
    ...state,
    version: 1,
    words,
    /* 種まきの対象が 0 件でも印を立てる。次回以降に byWord が増えても
       「あとから発音の履歴が生えてくる」ことはない (移行は 1 回きり) */
    migratedFromPronunciation: true,
  };
}
