import { expect, test } from "@playwright/test";

/**
 * 学習1周 — カードを見る → クイズを1ラウンド完走する → 進捗に出る。
 *
 * ここが壊れると「子どもが遊んだのに記録が残らない」= 一番痛い不具合になる。
 * 単体/API テストでは画面とサーバーの結線までは見えないので、E2E で押さえる。
 *
 * 前提: `npm run test:e2e` が `scripts/e2e/prepare.mjs` で
 * 署名済みセッション cookie と専用データディレクトリを用意している。
 */

test.describe("カード", () => {
  test("めくったカードが「きょうの できた」に反映される", async ({ page }) => {
    await page.goto("/flashcards");
    await expect(page.getByRole("heading", { name: "フラッシュカード" })).toBeVisible();

    /* 3 枚めくる。めくるたびに POST /api/progress/cards が飛ぶ (#76) */
    for (let i = 0; i < 3; i += 1) {
      const posted = page.waitForResponse(
        (res) => res.url().includes("/api/progress/cards") && res.request().method() === "POST",
      );
      await page.getByTestId("flashcard").click();
      await posted;
      if (i < 2) await page.getByTestId("flashcard-next").click();
    }

    await page.goto("/progress");
    await expect(page.getByTestId("stat-cards")).toContainText("3");
  });
});

test.describe("クイズ", () => {
  test("1ラウンド完走すると出題数が反映される", async ({ page }) => {
    await page.goto("/quiz");

    /* いちばん上のレベル (beginner) で始める */
    await page.getByTestId("quiz-level").first().click();

    for (let i = 0; i < 8; i += 1) {
      /* 正誤は問わない (採点はロジックの単体テストで見る)。
         ここで確かめるのは「8 問の記録が残る」こと */
      const posted = page.waitForResponse(
        (res) => res.url().includes("/api/progress/quiz") && res.request().method() === "POST",
      );
      await page.getByTestId("quiz-choice").first().click();
      await posted;
      await page.getByTestId("quiz-next").click();
    }

    await expect(page.getByText(/もん\s*せいかい/)).toBeVisible();

    await page.goto("/progress");
    await expect(page.getByTestId("stat-quiz")).toContainText("8");
  });
});
