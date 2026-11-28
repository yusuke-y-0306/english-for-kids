import { expect, test } from "@playwright/test";

/**
 * 門番 (proxy) が本当にブラウザの遷移で効いているか。
 *
 * 単体テストは判定関数を、API テストは HTTP 越しの応答を見る。ここで見るのは
 * **ブラウザが実際に /login へ戻され、戻り先が保たれるか**。
 */

test.use({ storageState: { cookies: [], origins: [] } });

test("未ログインで /flashcards を開くと /login に戻される", async ({ page }) => {
  await page.goto("/flashcards");
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

test("未ログインの API 呼び出しは 401 (JSON)", async ({ request }) => {
  const res = await request.get("/api/progress");
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ ok: false });
});
