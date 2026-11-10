import { jsonError, jsonOk, readJsonLimited } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { dayKeyOf } from "@/lib/progress/day";
import { recordCardView } from "@/lib/progress/store";
import { findWordById } from "@/lib/words";

/**
 * カードを 1 枚めくったことを記録する — issue #76 (親: #4 進捗管理)
 *
 * クイズ (#65) と同じ流儀:
 *  - **`getCurrentUser()` を最初に呼ぶ** (Route Handler は layout の保護対象外)
 *  - **`userId` はセッションからのみ**取る。ボディの `userId` は読まない (IDOR 対策)
 *  - **`eventId` を冪等キーにする**。同じ ID の再送は数えない
 *  - 値はホワイトリスト (`findWordById`) で検証する
 *  - 失敗しても内部パスやスタックトレースは返さない
 */

export const dynamic = "force-dynamic";

/** 単語 ID と UUID しか運ばない。1KB で十分 */
const MAX_BODY_BYTES = 1024;

/** クライアントは `crypto.randomUUID()` で作る (クイズの roundId と同じ形) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CardBody = {
  eventId?: unknown;
  wordId?: unknown;
};

export async function POST(request: Request) {
  // 1. 認証。未ログインなら何も書かないし、何も教えない。
  const user = await getCurrentUser();
  if (!user) return jsonError("ログインが必要です", 401);

  // 2. ボディ (サイズ上限つき)
  const parsed = await readJsonLimited<CardBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return jsonError("リクエストが大きすぎます", 413);
    return jsonError("リクエストの形式が正しくありません", 400);
  }

  // 3. ホワイトリスト検証
  const { eventId, wordId } = parsed.body;
  if (typeof eventId !== "string" || !UUID_PATTERN.test(eventId)) {
    return jsonError("eventId が不正です", 400);
  }
  if (typeof wordId !== "string" || !findWordById(wordId)) {
    return jsonError("単語 ID が不正です", 400);
  }

  // 4. 保存。userId はセッションから取った値だけを使う。
  const day = dayKeyOf();
  try {
    const { state, duplicate } = await recordCardView(user.id, {
      eventId,
      day,
      wordId,
      now: new Date().toISOString(),
    });
    /* 返すのは当日と単語の回数だけ。ファイルパスもユーザー ID も返さない */
    return jsonOk({
      day,
      duplicate,
      views: state.days[day]?.cards.views ?? 0,
      wordViews: state.cards[wordId]?.views ?? 0,
    });
  } catch (error) {
    // 詳細はサーバのログにだけ出す (クライアントには返さない)
    console.error("[api/progress/cards] 保存に失敗しました:", error);
    return jsonError("保存に失敗しました", 500);
  }
}
