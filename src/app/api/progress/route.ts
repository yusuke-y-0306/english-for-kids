import { jsonError, jsonOk } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { loadProgressSnapshot } from "@/lib/progress/snapshot";

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
 *  - 組み立ては `loadProgressSnapshot()` に任せる。画面 (#68) と同じ関数を通すので、
 *    表示と JSON の数字が食い違わない。
 *  - **`cache-control: no-store`**。個人の学習履歴を CDN / ブラウザに残さない。
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 1. 認証。未ログインなら何も返さない (何も教えない)。
  const user = await getCurrentUser();
  if (!user) return jsonError("ログインが必要です", 401);

  const rawDays = new URL(request.url).searchParams.get("days");

  try {
    const snapshot = await loadProgressSnapshot(user.id, { days: rawDays });
    const response = jsonOk({ ...snapshot });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    // 詳細はサーバのログにだけ出す (クライアントには返さない)
    console.error("[api/progress] 集計に失敗しました:", error);
    return jsonError("集計に失敗しました", 500);
  }
}
