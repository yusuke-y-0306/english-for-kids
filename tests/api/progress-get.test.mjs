import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * 進捗の取得 API — issue #67
 *
 * 固定したい主張:
 *  1. 未ログインは 401 で、**自分のデータだけ** が返る (クエリの uid は読まない)
 *  2. `?days=` は 1〜90 にクランプされ、不正値は既定 (7) に落ちる (400 にしない)
 *  3. 0 件の子でも例外にならず、0 で埋まった系列と空の集計が返る
 *  4. 日次・ストリーク・単語別・カテゴリ別が 1 レスポンスで揃う
 *  5. `cache-control: no-store` (個人の学習履歴を CDN / ブラウザに残さない)
 *
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";
/** 学習履歴ゼロの子 */
const USER_B = "u_bravo000000000000";

const ENDPOINT = "/api/progress";

let baseUrl;
let server;
let dataDir;
let contentDir;

/** サーバと同じ「日本時間のきょう」 */
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function sessionCookie(uid) {
  const now = Math.floor(Date.now() / 1000);
  /* tv / dv はセッションの世代 (issue #52)。無いと失効扱いで 401 になる */
  return signToken({ uid, iat: now - 60, exp: now + 3600, tv: 0, dv: 0 });
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function get(query = "", { cookie } = {}) {
  return fetch(`${baseUrl}${ENDPOINT}${query}`, {
    headers: cookie ? { cookie: `efk_session=${cookie}` } : {},
  });
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-api-test-"));
  contentDir = path.join(dataDir, "content");
  await mkdir(contentDir, { recursive: true });

  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [USER_A, USER_B].map((id) => ({
        id,
        displayName: id,
        avatar: "fox",
        color: "#7dd3fc",
        credentials: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
  );

  const today = todayKey();
  const yesterday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 86_400_000));

  /* 既存ユーザー: 今日と昨日に学習、クイズ 2 ラウンド + 発音 3 回 */
  await writeFile(
    path.join(contentDir, `${USER_A}.json`),
    JSON.stringify({
      userId: USER_A,
      visits: 9,
      data: {
        progress: {
          version: 1,
          days: {
            [yesterday]: {
              quiz: { rounds: 1, correct: 6, total: 8 },
              pronunciation: { attempts: 0, ok: 0 },
            },
            [today]: {
              quiz: { rounds: 1, correct: 2, total: 3 },
              pronunciation: { attempts: 3, ok: 2 },
            },
          },
          words: {
            "animals/dog": { correct: 3, wrong: 0, lastAt: "2026-11-01T00:00:00.000Z" },
            "animals/cat": { correct: 0, wrong: 1, lastAt: "2026-11-01T00:00:00.000Z" },
          },
          quizRoundIds: [],
          /* 保存値の方が長い (保持期間より前の記録) → API は max を返す */
          longestStreak: 5,
          lastStudyAt: "2026-11-09T00:00:00.000Z",
          updatedAt: "2026-11-09T00:00:00.000Z",
        },
        pronunciation: {
          version: 1,
          totalAttempts: 3,
          lastAttemptAt: "2026-11-09T00:00:00.000Z",
          byWord: {
            "food/apple": { score: "ok", attempts: 2, updatedAt: "2026-11-09T00:00:00.000Z" },
            "food/rice": { score: "retry", attempts: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
          },
        },
      },
    }),
  );

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        AUTH_DATA_DIR: dataDir,
        SESSION_SECRET,
        USERPOOL_MASTER_KEY: randomBytes(32).toString("base64"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      /* 認可の入口 (proxy) では未ログインは 401。
         「応答が返ってきた = 起動した」と見なす (ステータスは問わない) */
      await fetch(`${baseUrl}/api/auth/me`);
      break;
    } catch {
      // まだ起動中
    }
    if (Date.now() > deadline) throw new Error(`サーバが起動しませんでした:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

after(async () => {
  server?.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
});

describe("未認証", () => {
  test("cookie 無しは 401 で、内部情報を漏らさない", async () => {
    const res = await get();
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+|at .*\(.*:\d+:\d+\)/);
  });

  test("改ざんされた cookie も 401", async () => {
    const token = sessionCookie(USER_A);
    const body = token.slice(0, token.lastIndexOf("."));
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const broken = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const res = await fetch(`${baseUrl}${ENDPOINT}`, { headers: { cookie: `efk_session=${body}.${broken}` } });
    assert.equal(res.status, 401);
  });
});

describe("ログイン済み: 形と数字", () => {
  test("既定は 7 日で、最後がきょう (JST)", async () => {
    const res = await get("", { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.today, todayKey());
    assert.equal(body.days.length, 7);
    assert.equal(body.days[6].day, todayKey());
    /* 古い順 */
    assert.ok(body.days[0].day < body.days[6].day);
  });

  test("当日の学習量が入っている", async () => {
    const body = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    const today = body.days[6];
    assert.deepEqual(today.quiz, { rounds: 1, correct: 2, total: 3, accuracy: 67 });
    assert.deepEqual(today.pronunciation, { attempts: 3, ok: 2 });
    assert.equal(today.studied, true);
  });

  test("ストリークは今日と昨日で 2、longest は保存値との大きい方", async () => {
    const body = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    assert.equal(body.streak.current, 2);
    assert.equal(body.streak.longest, 5, "保存値 (保持期間より前) を採る");
    assert.equal(body.streak.studiedToday, true);
    assert.equal(body.streak.lastStudyDay, todayKey());
  });

  test("単語別の習得度が返る", async () => {
    const body = await (await get("", { cookie: sessionCookie(USER_A) })).json();

    /* クイズ 3 回正解 → 覚えた */
    assert.equal(body.words["animals/dog"].level, "mastered");
    assert.equal(body.words["animals/dog"].correct, 3);
    /* 発音 ok だけ → 練習中 (クイズの正解が無い) */
    assert.equal(body.words["food/apple"].level, "learning");
    assert.deepEqual(body.words["food/apple"].pronunciation, { attempts: 2, ok: true });
    assert.equal(body.words["food/rice"].level, "learning");
    /* 記録の無い単語は返さない (payload を膨らませない) */
    assert.equal(body.words["animals/bear"], undefined);
  });

  test("カテゴリ別の達成度が全カテゴリぶん返る", async () => {
    const body = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    assert.equal(body.categories.length, 6);
    const animals = body.categories.find((c) => c.id === "animals");
    assert.equal(animals.mastered, 1, "dog");
    assert.equal(animals.learning, 1, "cat");
    assert.equal(animals.mastered + animals.learning + animals.unseen, animals.total);
  });

  test("発音の累計 (正は発音ストア) も返る", async () => {
    const body = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    assert.equal(body.pronunciation.totalAttempts, 3);
    assert.equal(typeof body.pronunciation.lastAttemptAt, "string");
  });
});

describe("days のクランプ", () => {
  const cases = [
    ["0", 1],
    ["-5", 1],
    ["1", 1],
    ["30", 30],
    ["91", 90],
    ["1000", 90],
    ["abc", 7],
    ["7days", 7],
    ["", 7],
  ];

  for (const [raw, expected] of cases) {
    test(`days=${raw || "(空)"} は ${expected} 日`, async () => {
      const res = await get(`?days=${encodeURIComponent(raw)}`, { cookie: sessionCookie(USER_A) });
      assert.equal(res.status, 200, "不正値でも 400 にしない");
      const body = await res.json();
      assert.equal(body.days.length, expected);
      assert.equal(body.days[body.days.length - 1].day, todayKey());
    });
  }
});

describe("自分のデータだけが返る", () => {
  test("学習履歴ゼロの子は 0 で埋まった系列", async () => {
    const res = await get("", { cookie: sessionCookie(USER_B) });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.days.length, 7);
    for (const day of body.days) {
      assert.equal(day.studied, false);
      assert.deepEqual(day.quiz, { rounds: 0, correct: 0, total: 0, accuracy: 0 });
      assert.deepEqual(day.pronunciation, { attempts: 0, ok: 0 });
    }
    assert.deepEqual(body.streak, { current: 0, longest: 0, studiedToday: false, lastStudyDay: null });
    assert.deepEqual(body.words, {});
    /* カテゴリは必ず全件返る (画面が「まだ 0 / 8」を出せる) */
    assert.equal(body.categories.length, 6);
    assert.equal(body.pronunciation.totalAttempts, 0);
  });

  test("クエリで他人の uid を渡しても無視される (IDOR 防止)", async () => {
    const own = await (await get("", { cookie: sessionCookie(USER_B) })).json();
    const attacked = await (
      await get(`?userId=${USER_A}&uid=${USER_A}`, { cookie: sessionCookie(USER_B) })
    ).json();

    assert.deepEqual(attacked.words, own.words);
    assert.equal(attacked.streak.current, own.streak.current);
    assert.equal(attacked.pronunciation.totalAttempts, own.pronunciation.totalAttempts);
    /* A のデータが漏れていない */
    assert.deepEqual(attacked.categories.find((c) => c.id === "animals").mastered, 0);
  });

  test("POST は 405 で、集計も変わらない", async () => {
    const before = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    const res = await fetch(`${baseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `efk_session=${sessionCookie(USER_A)}` },
      body: JSON.stringify({ days: 30 }),
    });
    assert.equal(res.status, 405);

    const after = await (await get("", { cookie: sessionCookie(USER_A) })).json();
    assert.deepEqual(after.days, before.days);
  });
});
