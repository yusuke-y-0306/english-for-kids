import { jsonError, jsonOk, readJsonLimited } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import {
  isPronunciationScore,
  recordPronunciationAttempt,
} from "@/lib/speech/pronunciation-store";
import { findWordById } from "@/lib/words";

/**
 * 発音練習の結果を 1 回分記録する — issue #32
 *
 * 設計の要点 (ここを崩すとセキュリティが壊れる):
 *  - **`getCurrentUser()` を最初に呼ぶ**。Route Handler は `(protected)/layout.tsx` の
 *    保護対象外なので、自前で確かめない限り完全に無認証になる。
 *  - **`userId` はセッションからのみ**取る。ボディの `userId` は**読まない**
 *    (読むと他人の学習データを読み書きできる = IDOR)。
 *  - 受け取るのは **単語 ID と 3 段階スコアだけ**。音声・認識テキストは受け取らない。
 *  - 値はホワイトリストで検証する (`words.ts` に存在する単語 ID / ok|close|retry のみ)。
 *  - 失敗しても内部パスやスタックトレースは返さない。
 */

export const dynamic = "force-dynamic";

/** 数十 KB あれば十分。発音結果は 2 つの短い文字列しか運ばない。 */
const MAX_BODY_BYTES = 8 * 1024;

type AttemptBody = {
  wordId?: unknown;
  score?: unknown;
};

export async function POST(request: Request) {
  // 1. 認証・認可。未ログインなら何も書かないし、何も教えない。
  const user = await getCurrentUser();
  if (!user) return jsonError("ログインが必要です", 401);

  // 2. ボディ (サイズ上限つき)
  const parsed = await readJsonLimited<AttemptBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return jsonError("リクエストが大きすぎます", 413);
    return jsonError("リクエストの形式が正しくありません", 400);
  }

  // 3. ホワイトリスト検証
  const { wordId, score } = parsed.body;
  if (typeof wordId !== "string" || !findWordById(wordId)) {
    return jsonError("単語 ID が不正です", 400);
  }
  if (!isPronunciationScore(score)) {
    return jsonError("スコアが不正です", 400);
  }

  // 4. 保存。userId はセッションから取った値だけを使う。
  try {
    const state = await recordPronunciationAttempt(user.id, wordId, score);
    return jsonOk({
      wordId,
      score,
      attempts: state.byWord[wordId]?.attempts ?? 1,
      totalAttempts: state.totalAttempts,
    });
  } catch (error) {
    // 詳細はサーバのログにだけ出す (クライアントには返さない)
    console.error("[api/pronunciation/attempt] 保存に失敗しました:", error);
    return jsonError("保存に失敗しました", 500);
  }
}
