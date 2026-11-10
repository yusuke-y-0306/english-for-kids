import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { describe } from "node:test";

/**
 * 「記録 API はあるのに、画面が呼んでいない」を防ぐ — issue #76
 *
 * #65 / #67 の API と進捗ページはサーバ側のテストで守られていたが、
 * **クイズ画面が `/api/progress/quiz` を一度も呼んでいなかった**ため、
 * 遊んでも数字が動かなかった。サーバのテストだけでは見つけられない穴なので、
 * 画面のソースが送信処理を持っていることだけをここで固定する。
 *
 * （DOM を動かすテストではない。送信先と冪等キーの有無を見るだけの柵）
 */

const QUIZ_PAGE = "src/app/(protected)/quiz/page.tsx";
const FLASHCARDS_PAGE = "src/app/(protected)/flashcards/page.tsx";
const CARD_API = "src/app/api/progress/cards/route.ts";

describe("クイズ画面の記録配線", () => {
  test("ラウンド終了時に /api/progress/quiz へ送る", async () => {
    const source = await readFile(QUIZ_PAGE, "utf8");
    assert.match(source, /\/api\/progress\/quiz/);
    assert.match(source, /roundId/);
    assert.match(source, /wordId: question\.wordId \?\? null/, "初級の単語 ID を結果に載せる");
  });
});

describe("カード画面の記録配線", () => {
  test("意味をめくったときに /api/progress/cards へ送る", async () => {
    const source = await readFile(FLASHCARDS_PAGE, "utf8");
    assert.match(source, /\/api\/progress\/cards/);
    assert.match(source, /eventId/);
    assert.match(source, /wordId/);
  });

  test("記録 API は冪等キー eventId を検証する", async () => {
    const source = await readFile(CARD_API, "utf8");
    assert.match(source, /eventId/);
    assert.match(source, /UUID_PATTERN/);
  });
});
