import { getUserContent, updateUserContent } from "@/lib/auth/content";
import { isPronunciationScore, type PronunciationScore } from "./scores";

/**
 * 発音練習の結果を保存する — issue #32
 *
 * 保存するのは **単語 ID と 3 段階スコアだけ**。
 * 音声そのもの・認識されたテキスト全文は保存しない (保存しないものは漏れない)。
 *
 * ストアは既存のユーザー単位 JSON (`data/content/<uid>.json`) の `data.pronunciation` を使う。
 * #4 (進捗管理) も同じストアに載る想定なので、キーは機能ごとに分けて衝突を避ける。
 */

export { PRONUNCIATION_SCORES, isPronunciationScore } from "./scores";
export type { PronunciationScore } from "./scores";

export type PronunciationWordState = {
  /** 直近の判定 */
  score: PronunciationScore;
  /** この単語を試した回数 */
  attempts: number;
  /** 最終挑戦日時 (ISO 8601) */
  updatedAt: string;
};

export type PronunciationState = {
  version: 1;
  /** 全単語合計の挑戦回数 */
  totalAttempts: number;
  /** 最後に挑戦した日時 (ISO 8601) */
  lastAttemptAt: string | null;
  /** 単語 ID → 状態 (単語数で上限が決まるので無限には増えない) */
  byWord: Record<string, PronunciationWordState>;
};

export const EMPTY_PRONUNCIATION_STATE: PronunciationState = {
  version: 1,
  totalAttempts: 0,
  lastAttemptAt: null,
  byWord: {},
};

/**
 * 保存済みの値を読み直して正規化する。
 * ファイルは自分たちが書いたものだが、**古い版や手編集で壊れていても落ちない**ようにする。
 */
export function normalizePronunciationState(raw: unknown): PronunciationState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PRONUNCIATION_STATE, byWord: {} };
  const source = raw as Partial<PronunciationState>;
  const byWord: Record<string, PronunciationWordState> = {};

  if (source.byWord && typeof source.byWord === "object") {
    for (const [id, value] of Object.entries(source.byWord)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<PronunciationWordState>;
      if (!isPronunciationScore(entry.score)) continue;
      const attempts = Number(entry.attempts);
      byWord[id] = {
        score: entry.score,
        attempts: Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString(),
      };
    }
  }

  const totalAttempts = Number(source.totalAttempts);
  return {
    version: 1,
    totalAttempts: Number.isFinite(totalAttempts) && totalAttempts >= 0 ? Math.floor(totalAttempts) : 0,
    lastAttemptAt: typeof source.lastAttemptAt === "string" ? source.lastAttemptAt : null,
    byWord,
  };
}

/**
 * ユーザーごとの直列化。
 *
 * `updateUserContent()` は read-modify-write なので、同じ子が連打すると
 * 更新が取りこぼされる。単一プロセスで動く前提の簡易ロックで直列化する
 * (再起動で消えるが、失われるのは同時実行時の競合だけ)。
 */
const locks = new Map<string, Promise<void>>();

async function withUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const guard = current.then(
    () => undefined,
    () => undefined,
  );
  locks.set(userId, guard);
  try {
    return await current;
  } finally {
    // 自分が最後の番なら後片付けする (Map が無限に増えないように)
    if (locks.get(userId) === guard) locks.delete(userId);
  }
}

/** 現在の状態を読む (存在しなければ空) */
export async function getPronunciationState(userId: string): Promise<PronunciationState> {
  const content = await getUserContent(userId);
  return normalizePronunciationState(content.data.pronunciation);
}

/**
 * 1 回分の結果を記録する。
 *
 * `userId` は **呼び出し側 (Route Handler) がセッションから取った値**を渡すこと。
 * リクエストボディの値を通してはいけない (issue #32 の本体)。
 */
export async function recordPronunciationAttempt(
  userId: string,
  wordId: string,
  score: PronunciationScore,
  now: Date = new Date(),
): Promise<PronunciationState> {
  return withUserLock(userId, async () => {
    const content = await getUserContent(userId);
    const state = normalizePronunciationState(content.data.pronunciation);
    const previous = state.byWord[wordId];
    const at = now.toISOString();

    const next: PronunciationState = {
      version: 1,
      totalAttempts: state.totalAttempts + 1,
      lastAttemptAt: at,
      byWord: {
        ...state.byWord,
        [wordId]: {
          score,
          attempts: (previous?.attempts ?? 0) + 1,
          updatedAt: at,
        },
      },
    };

    // 既存のアトミック更新 (tmp + rename) をそのまま使う
    await updateUserContent(userId, { pronunciation: next });
    return next;
  });
}
