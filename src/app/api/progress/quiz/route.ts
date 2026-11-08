import { jsonError, jsonOk, readJsonLimited } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { dayKeyOf } from "@/lib/progress/day";
import { summaryForDay } from "@/lib/progress/state";
import { recordQuizRound } from "@/lib/progress/store";
import { QUIZ_LENGTH, isQuizLevelId } from "@/lib/quiz";
import { findWordById } from "@/lib/words";

/**
 * クイズ 1 ラウンドの結果を記録する — issue #65 (親: #4 進捗管理)
 *
 * 設計の要点 (発音 API #32 と同じ流儀):
 *  - **`getCurrentUser()` を最初に呼ぶ**。Route Handler は `(protected)/layout.tsx` の
 *    保護対象外なので、自前で確かめない限り無認証になる (proxy の default-deny が一次防御)。
 *  - **`userId` はセッションからのみ**取る。ボディの `userId` は**読まない**
 *    (読むと他人の学習履歴を書ける = IDOR)。
 *  - **`roundId` を冪等キーにする**。同じ ID の再送は加算しない
 *    (リロード・二重タップ・オフライン復帰で数字が水増しされない)。
 *  - 値はホワイトリスト (`isQuizLevelId` / `findWordById`) で検証し、
 *    件数は `QUIZ_LENGTH` で頭打ちにする。
 *  - 失敗しても内部パスやスタックトレースは返さない。
 */

export const dynamic = "force-dynamic";

/** 8 問ぶんの `{wordId, correct}` + `roundId` + `level`。2KB で十分すぎる */
const MAX_BODY_BYTES = 2 * 1024;

/** クライアントは `crypto.randomUUID()` で作る。形だけ厳密に見る (v4 に固定はしない) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QuizBody = {
  roundId?: unknown;
  level?: unknown;
  results?: unknown;
};

type CheckedResult = { wordId: string | null; correct: boolean };

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
    const { wordId, correct } = entry as { wordId?: unknown; correct?: unknown };
    if (typeof correct !== "boolean") {
      return jsonError("results が不正です", 400);
    }
    /* 単語を持たない問題 (中級・上級の文法) は null / 省略で来る。
       文字列で来たときだけ「words.ts に実在するか」を確かめる */
    if (wordId === undefined || wordId === null) {
      checked.push({ wordId: null, correct });
      continue;
    }
    if (typeof wordId !== "string" || !findWordById(wordId)) {
      return jsonError("単語 ID が不正です", 400);
    }
    checked.push({ wordId, correct });
  }

  // 4. 保存。userId はセッションから取った値だけを使う。
  const day = dayKeyOf();
  try {
    const { state, duplicate } = await recordQuizRound(user.id, {
      roundId,
      day,
      results: checked,
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
