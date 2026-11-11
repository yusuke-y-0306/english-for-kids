import { jsonError, jsonOk, readJsonLimited } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { dayKeyOf } from "@/lib/progress/day";
import { summaryForDay } from "@/lib/progress/state";
import { recordQuizRound } from "@/lib/progress/store";
import { QUIZ_LENGTH, isQuizLevelId } from "@/lib/quiz";
import { findWordById } from "@/lib/words";

/**
 * クイズの回答を記録する — issue #65 / #76 (親: #4 進捗管理)
 *
 * 設計の要点 (発音 API #32 と同じ流儀):
 *  - **`getCurrentUser()` を最初に呼ぶ**。Route Handler は `(protected)/layout.tsx` の
 *    保護対象外なので、自前で確かめない限り無認証になる (proxy の default-deny が一次防御)。
 *  - **`userId` はセッションからのみ**取る。ボディの `userId` は**読まない**
 *    (読むと他人の学習履歴を書ける = IDOR)。
 *  - **1 問ごとに記録する**。カードを 1 枚めくれば記録されるのに、クイズは
 *    8 問終えるまで記録されない、という不公平を無くす (#76 のレビュー)。
 *    クライアントは 1 問答えるたびに「その時点までの回答」を送る。
 *  - **`answerId` を 1 問ぶんの冪等キーにする**。同じ回答の再送は加算しない
 *    (リロード・二重タップ・オフライン復帰で数字が水増しされない)。
 *    ラウンド数だけは 8 問そろった送信で 1 回増える (`roundId` で冪等)。
 *  - 値はホワイトリスト (`isQuizLevelId` / `findWordById`) で検証し、
 *    件数は `QUIZ_LENGTH` で頭打ちにする。
 *  - 失敗しても内部パスやスタックトレースは返さない。
 */

export const dynamic = "force-dynamic";

/** 8 問ぶんの `{answerId, wordId, correct}` + `roundId` + `level`。2KB で十分すぎる */
const MAX_BODY_BYTES = 2 * 1024;

/** クライアントは `crypto.randomUUID()` で作る。形だけ厳密に見る (v4 に固定はしない) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QuizBody = {
  roundId?: unknown;
  level?: unknown;
  results?: unknown;
};

type CheckedResult = { wordId: string | null; correct: boolean; answerId?: string };

export async function POST(request: Request) {
  // 1. 認証。未ログインなら何も書かないし、何も教えない。
  const user = await getCurrentUser();
  if (!user) return jsonError("ログインが必要です", 401);

  // 2. ボディ (サイズ上限つき)
  const parsed = await readJsonLimited<QuizBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return jsonError("リクエストが大きすぎます", 413);
    return jsonError("リクエストの形式が正しくありません", 400);
  }

  // 3. ホワイトリスト検証
  const { roundId, level, results } = parsed.body;
  if (typeof roundId !== "string" || !UUID_PATTERN.test(roundId)) {
    return jsonError("roundId が不正です", 400);
  }
  if (!isQuizLevelId(level)) {
    return jsonError("レベルが不正です", 400);
  }
  if (!Array.isArray(results) || results.length === 0 || results.length > QUIZ_LENGTH) {
    return jsonError("results が不正です", 400);
  }

  const checked: CheckedResult[] = [];
  for (const entry of results) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return jsonError("results が不正です", 400);
    }
    const { wordId, correct, answerId } = entry as {
      wordId?: unknown;
      correct?: unknown;
      answerId?: unknown;
    };
    if (typeof correct !== "boolean") {
      return jsonError("results が不正です", 400);
    }
    /* 省略可 (省略時はラウンド内の位置で代用する)。来たときだけ UUID を確かめる */
    if (answerId !== undefined && (typeof answerId !== "string" || !UUID_PATTERN.test(answerId))) {
      return jsonError("answerId が不正です", 400);
    }
    /* 単語を持たない問題 (中級・上級の文法) は null / 省略で来る。
       文字列で来たときだけ「words.ts に実在するか」を確かめる */
    if (wordId === undefined || wordId === null) {
      checked.push({ wordId: null, correct, ...(typeof answerId === "string" ? { answerId } : {}) });
      continue;
    }
    if (typeof wordId !== "string" || !findWordById(wordId)) {
      return jsonError("単語 ID が不正です", 400);
    }
    checked.push({ wordId, correct, ...(typeof answerId === "string" ? { answerId } : {}) });
  }

  // 4. 保存。userId はセッションから取った値だけを使う。
  const day = dayKeyOf();
  try {
    const { state, duplicate } = await recordQuizRound(user.id, {
      roundId,
      day,
      results: checked,
      /* 8 問そろった送信だけが「ラウンド完走」。途中でも回答は記録される */
      roundComplete: checked.length === QUIZ_LENGTH,
      now: new Date().toISOString(),
    });
    /* 返すのは当日の集計だけ。ファイルパスもユーザー ID も返さない */
    return jsonOk({ day, duplicate, ...summaryForDay(state, day) });
  } catch (error) {
    // 詳細はサーバのログにだけ出す (クライアントには返さない)
    console.error("[api/progress/quiz] 保存に失敗しました:", error);
    return jsonError("保存に失敗しました", 500);
  }
}
