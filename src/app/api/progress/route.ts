import { jsonError, jsonOk } from "@/lib/auth/http";
import { getUserContent } from "@/lib/auth/content";
import { getCurrentUser } from "@/lib/auth/session";
import { dayKeyOf } from "@/lib/progress/day";
import { normalizeProgressState } from "@/lib/progress/state";
import { normalizePronunciationState } from "@/lib/speech/pronunciation-store";
import { streakOf } from "@/lib/progress/streak";
import { summarizeCategories, summarizeDaily, summarizeWords } from "@/lib/progress/summary";
import { allWordIds, categories } from "@/lib/words";

/**
 * 進捗の取得 — issue #67 (親: #4 進捗管理)
 *
 * 設計の要点 (記録側の #65 / #66 と同じ流儀):
 *  - **`getCurrentUser()` を最初に呼ぶ**。Route Handler は `(protected)/layout.tsx` の
 *    保護対象外なので、自前で確かめない限り無認証になる (proxy の default-deny が一次防御)。
 *  - **`userId` はセッションからのみ**取る。クエリにもボディにも `uid` を受け付けない
 *    (受け付けたら他人の学習履歴を読める = IDOR)。
 *  - `?days=` は 1〜90 に丸める。**不正値は 400 にせず既定 (7) に落とす**
 *    (URL をいじっただけで画面がエラーになる方が不親切)。
 *  - 数字の作り方は `summary.ts` / `streak.ts` の純粋関数だけ。ここは組み立てるだけ。
 *  - **`cache-control: no-store`**。個人の学習履歴を CDN / ブラウザに残さない。
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 1. 認証。未ログインなら何も返さない (何も教えない)。
  const user = await getCurrentUser();
  if (!user) return jsonError("ログインが必要です", 401);

  const rawDays = new URL(request.url).searchParams.get("days");

  try {
    /* 発音と進捗は同じファイル。1 回読んで両方のキーを取り出す */
    const content = await getUserContent(user.id);
    const state = normalizeProgressState(content.data.progress);
    const pronunciation = normalizePronunciationState(content.data.pronunciation);

    const today = dayKeyOf();
    const streak = streakOf(state.days, today);
    /* 集計の入力。「どこに何が正か」を 1 か所にまとめて渡す */
    const input = {
      days: state.days,
      words: state.words,
      pronunciation: pronunciation.byWord,
    };

    const response = jsonOk({
      today,
      days: summarizeDaily(input, { days: rawDays, today }),
      streak: {
        current: streak.current,
        /* 保存値は保持期間 (400 日) より前の記録を持っていることがあるので長い方を採る */
        longest: Math.max(state.longestStreak, streak.longest),
        studiedToday: streak.studiedToday,
        lastStudyDay: streak.lastStudyDay,
      },
      words: summarizeWords(input, allWordIds()),
      categories: summarizeCategories(input, categories),
      /* 累計の正は発音ストア (#66 の分担)。日次は上の days にある */
      pronunciation: {
        totalAttempts: pronunciation.totalAttempts,
        lastAttemptAt: pronunciation.lastAttemptAt,
      },
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    // 詳細はサーバのログにだけ出す (クライアントには返さない)
    console.error("[api/progress] 集計に失敗しました:", error);
    return jsonError("集計に失敗しました", 500);
  }
}
