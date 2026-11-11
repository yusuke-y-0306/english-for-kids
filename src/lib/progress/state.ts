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
  cards: {
    /** その日にカードで意味を見た回数 */
    views: number;
  };
};

/** 単語ごとの手応え (クイズの正誤だけを数える。発音は発音ストアが正) */
export type ProgressWordState = {
  correct: number;
  wrong: number;
  /** 最後に触った日時 (ISO 8601) */
  lastAt: string;
};

/**
 * カードで見た単語の記録。
 *
 * クイズの正誤 (`words`) とは **別の事実** として持つ。カードを見ただけで
 * 「正解した」ことにすると習得度が水増しされるので、`words` には混ぜない。
 * 進捗ページでは「れんしゅうちゅう」の根拠としてだけ使う。
 */
export type ProgressCardState = {
  /** カードをめくって意味を見た回数 */
  views: number;
  /** 最後に見た日時 (ISO 8601) */
  lastAt: string;
};

export type ProgressState = {
  version: 1;
  /** `YYYY-MM-DD` (JST) → その日の学習量 */
  days: Record<string, ProgressDay>;
  /** 単語 ID → 正誤の累計 */
  words: Record<string, ProgressWordState>;
  /** 単語 ID → カードで見た回数 (クイズの正誤とは別勘定) */
  cards: Record<string, ProgressCardState>;
  /**
   * 直近に **完走した** クイズの `roundId` (新しい順)。
   *
   * ラウンド数 (`days[...].quiz.rounds`) を二重に数えないための鍵。
   * 1 ラウンド = 8 問を終えた送信だけがここに入る。直近
   * `QUIZ_ROUND_MEMORY` 件を輪のように持つ。
   */
  quizRoundIds: string[];
  /**
   * 直近に記録した **1 問ぶんの回答** の `answerId` (新しい順)。
   *
   * クイズは 1 問答えるたびに、その時点までの回答をまとめて送る (#76)。
   * 送信が失敗しても次の回答の送信に前の回答が載るので、自然に追いつく。
   * そのため同じ回答が 2 回届きうる。届いた順に数えると、がんばった子ほど
   * 数字が水増しされるので、処理済みの `answerId` は **数えない**。
   * 直近 `QUIZ_ANSWER_MEMORY` 件 (≈ 32 ラウンド × 8 問) を覚える。
   */
  quizAnswerIds: string[];
  /**
   * 直近に記録したカード閲覧の `eventId` (新しい順)。カード記録の **冪等キー**。
   *
   * カードは 1 枚めくるたびに 1 リクエスト送る。通信の再送や二重タップで
   * 同じ閲覧が 2 回来ても、同じ `eventId` なら数えない。
   */
  cardEventIds: string[];
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

/** 覚えておく「完走したラウンド」の `roundId` の件数 (#65) */
export const QUIZ_ROUND_MEMORY = 32;

/** 覚えておく「1 問ぶんの回答」の `answerId` の件数 (32 ラウンド × 8 問) */
export const QUIZ_ANSWER_MEMORY = 256;

/** 覚えておくカード閲覧 `eventId` の件数 (直近 64 枚) */
export const CARD_EVENT_MEMORY = 64;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function emptyDay(): ProgressDay {
  return {
    quiz: { rounds: 0, correct: 0, total: 0 },
    pronunciation: { attempts: 0, ok: 0 },
    cards: { views: 0 },
  };
}

export function emptyProgressState(): ProgressState {
  return {
    version: 1,
    days: {},
    words: {},
    cards: {},
    quizRoundIds: [],
    quizAnswerIds: [],
    cardEventIds: [],
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
        cards: { views: count(entry.cards?.views) },
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

  const cards: Record<string, ProgressCardState> = {};
  if (source.cards && typeof source.cards === "object") {
    for (const [wordId, value] of Object.entries(source.cards)) {
      if (wordId === "" || !value || typeof value !== "object") continue;
      const entry = value as Partial<ProgressCardState>;
      cards[wordId] = {
        views: count(entry.views),
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

  const quizAnswerIds: string[] = [];
  if (Array.isArray(source.quizAnswerIds)) {
    for (const id of source.quizAnswerIds) {
      if (typeof id !== "string" || id === "" || quizAnswerIds.includes(id)) continue;
      quizAnswerIds.push(id);
      if (quizAnswerIds.length >= QUIZ_ANSWER_MEMORY) break;
    }
  }

  const cardEventIds: string[] = [];
  if (Array.isArray(source.cardEventIds)) {
    for (const id of source.cardEventIds) {
      if (typeof id !== "string" || id === "" || cardEventIds.includes(id)) continue;
      cardEventIds.push(id);
      if (cardEventIds.length >= CARD_EVENT_MEMORY) break;
    }
  }

  return {
    version: 1,
    days,
    words,
    cards,
    quizRoundIds,
    quizAnswerIds,
    cardEventIds,
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

const DAY_MS = 86_400_000;

/**
 * その日に「学習した」と数えるか。
 *
 * `streak.ts` の `isStudiedDay()` と同じ判定 (クイズ 1 問・カード 1 枚・発音 1 回。
 * 画面を開いただけでは数えない)。ここは **保存用の最長記録** を数えるためだけに
 * 持っている。このファイルは import を持たないので、判定だけ 5 行を写している
 * (`shiftDay()` と同じ流儀。判定の正は `streak.ts`)。
 */
function isStudiedDay(entry: ProgressDay | undefined): boolean {
  if (!entry) return false;
  return (
    entry.quiz.rounds > 0 ||
    entry.quiz.total > 0 ||
    entry.pronunciation.attempts > 0 ||
    entry.cards.views > 0
  );
}

/**
 * 日次から最長の連続学習日数を数え直す (#69)。
 *
 * `longestStreak` は保存するのが正 (日次は 400 日で切るので、再計算だけだと
 * 保持期間より前の最長記録が失われる)。書き込みのたびに
 * `Math.max(保存値, この値)` で更新する。
 *
 * 表示用の `streakOf()` は「今日」を引数で受け取るが、こちらは保存用なので
 * 日次に残っている範囲の最長をそのまま数える。
 */
export function longestStreakOf(days: Record<string, ProgressDay>): number {
  const studied = Object.keys(days)
    .filter((day) => DAY_KEY_PATTERN.test(day) && isStudiedDay(days[day]))
    .sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of studied) {
    const expected =
      previous === null
        ? null
        : new Date(Date.parse(`${previous}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    run = expected === day ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }
  return longest;
}

export type QuizRoundInput = {
  /**
   * クライアントが作るラウンドの UUID (1 ラウンド = 8 問)。
   * 完走したラウンドを二重に数えないための鍵。
   * 空文字 / 未指定なら冪等性は効かない (テストや保守用の逃げ道)。
   */
  roundId: string;
  /** JST の日付 (`dayKeyOf()` で作る) */
  day: string;
  /**
   * 1 問ぶんの結果。単語 ID は呼び出し側で存在確認済みのもの。
   * `null` は「単語に紐づかない問題」（中級・上級の文法問題）。
   * その場合は日次の出題数・正解数だけ数え、単語別には触らない。
   *
   * `answerId` は 1 問ぶんの **冪等キー**。省略した場合は
   * `${roundId}:${index}` で代用する (クライアントは UUID を載せる)。
   */
  results: ReadonlyArray<{
    wordId: string | null;
    correct: boolean;
    answerId?: string;
  }>;
  /**
   * この送信で **8 問を終えた** か (ラウンド数の加算はこれが true のときだけ)。
   *
   * クイズは 1 問答えるたびに、その時点までの回答をまとめて送る (#76)。
   * 途中でやめたラウンドも「回答した事実」は残すが、ラウンド数は増やさない。
   * 呼び出し側 (Route Handler) が `QUIZ_LENGTH` と突き合わせて決める。
   */
  roundComplete?: boolean;
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
 * クイズの回答を足した新しい状態を返す (元の状態は変更しない)。
 *
 * 1 問答えるたびに「その時点までの回答」が届く (#76)。まだ数えていない
 * `answerId` の回答だけを足すので、同じ送信が 2 回届いても水増しされない。
 * ラウンド数 (`rounds`) は `roundComplete: true` の送信で 1 回だけ増える。
 *
 * 出題数が 0 の送信は「遊んでいない」ので数えない (空送信で水増しされない)。
 * 数えるものが無ければ **同じ状態をそのまま返す** (呼び出し側は参照が
 * 変わらないことで「書く必要が無い」と判断できる)。
 */
export function applyQuizRound(state: ProgressState, input: QuizRoundInput): ProgressState {
  if (input.results.length === 0) return state;

  const roundId = typeof input.roundId === "string" ? input.roundId : "";
  const seenAnswers = new Set(state.quizAnswerIds);
  const appliedAnswers: string[] = [];
  const fresh: Array<{ wordId: string | null; correct: boolean }> = [];

  input.results.forEach((result, index) => {
    /* 冪等キー。クライアントは UUID を載せる。無ければラウンド内の位置で代用する
       (同じ送信をそのまま再送する限り、位置は変わらない) */
    const answerId =
      typeof result.answerId === "string" && result.answerId !== ""
        ? result.answerId
        : roundId === ""
          ? ""
          : `${roundId}:${index}`;

    if (answerId !== "" && seenAnswers.has(answerId)) return;
    if (answerId !== "") seenAnswers.add(answerId);
    appliedAnswers.push(answerId);
    fresh.push({ wordId: result.wordId, correct: result.correct });
  });

  const countRound =
    input.roundComplete === true &&
    roundId !== "" &&
    !state.quizRoundIds.includes(roundId);

  if (fresh.length === 0 && !countRound) return state;

  const today = state.days[input.day] ?? emptyDay();
  const correct = fresh.filter((r) => r.correct).length;

  const words: Record<string, ProgressWordState> = { ...state.words };
  for (const result of fresh) {
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
        rounds: today.quiz.rounds + (countRound ? 1 : 0),
        correct: today.quiz.correct + correct,
        total: today.quiz.total + fresh.length,
      },
      pronunciation: { ...today.pronunciation },
      cards: { ...today.cards },
    },
  };
  const pruned = pruneDays(days);

  return {
    ...state,
    version: 1,
    days: pruned,
    words,
    quizRoundIds: countRound
      ? [roundId, ...state.quizRoundIds].slice(0, QUIZ_ROUND_MEMORY)
      : state.quizRoundIds,
    quizAnswerIds:
      appliedAnswers.length === 0
        ? state.quizAnswerIds
        : [...appliedAnswers.reverse(), ...state.quizAnswerIds]
            .filter((id, index, all) => id !== "" && all.indexOf(id) === index)
            .slice(0, QUIZ_ANSWER_MEMORY),
    /* #69: 保存時の最長記録。日次は 400 日で切るので、再計算だけでは失われる */
    longestStreak: Math.max(state.longestStreak, longestStreakOf(pruned)),
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
      cards: { ...today.cards },
    },
  };
  const pruned = pruneDays(days);

  return {
    ...state,
    version: 1,
    days: pruned,
    longestStreak: Math.max(state.longestStreak, longestStreakOf(pruned)),
    lastStudyAt: input.now,
    updatedAt: input.now,
  };
}

export type CardViewInput = {
  /**
   * クライアントが 1 枚めくるたびに作る UUID。**冪等キー**。
   * 空文字なら冪等性は効かない (テストや保守用の逃げ道)。
   */
  eventId: string;
  /** JST の日付 (`dayKeyOf()` で作る) */
  day: string;
  /** めくったカードの単語 ID (呼び出し側で存在確認済み) */
  wordId: string;
  /** 記録した日時 (ISO 8601) */
  now: string;
};

/**
 * カードを 1 枚めくったことを記録する。
 *
 * - 日次の `cards.views` を 1 増やす (「きょう何枚見たか」)
 * - 単語別の `cards[wordId].views` を 1 増やす (「この語を何回見たか」)
 * - 同じ `eventId` の再送は **数えない** (参照も変えない)
 *
 * クイズの `words` には触らない。見ただけでは「正解した」ことにならないため。
 */
export function applyCardView(state: ProgressState, input: CardViewInput): ProgressState {
  const eventId = typeof input.eventId === "string" ? input.eventId : "";
  if (eventId !== "" && state.cardEventIds.includes(eventId)) return state;

  const today = state.days[input.day] ?? emptyDay();
  const previous = state.cards[input.wordId];
  const pruned = pruneDays({
    ...state.days,
    [input.day]: {
      quiz: { ...today.quiz },
      pronunciation: { ...today.pronunciation },
      cards: { views: today.cards.views + 1 },
    },
  });

  return {
    ...state,
    version: 1,
    days: pruned,
    cards: {
      ...state.cards,
      [input.wordId]: {
        views: (previous?.views ?? 0) + 1,
        lastAt: input.now,
      },
    },
    cardEventIds:
      eventId === ""
        ? state.cardEventIds
        : [eventId, ...state.cardEventIds].slice(0, CARD_EVENT_MEMORY),
    longestStreak: Math.max(state.longestStreak, longestStreakOf(pruned)),
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
