import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * カード閲覧の記録 API — issue #76
 *
 * 固定したい主張:
 *  1. 未ログインでは**何も書かない** (userId はセッションからのみ = IDOR 不可)
 *  2. 同じ `eventId` の再送で数字が水増しされない (冪等キー)
 *  3. 単語 ID はホワイトリストで弾く (壊れたボディは 400)
 *  4. カードはクイズの正誤 (`words`) を汚さない (見た ≠ 正解)
 *  5. カードだけの日でも「学習した日」として記録される
 *
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";
const USER_B = "u_bravo000000000000";

const ENDPOINT = "/api/progress/cards";
const WORD_1 = "animals/dog";
const WORD_2 = "food/apple";

let baseUrl;
let server;
let dataDir;
let contentDir;

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function sessionCookie(uid, { expired = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  /* tv / dv はセッションの世代 (issue #52)。無いと失効扱いで 401 になる */
  return signToken({ uid, iat: now - 60, exp: expired ? now - 10 : now + 3600, tv: 0, dv: 0 });
}

function tamperedCookie(uid) {
  const token = sessionCookie(uid);
  const body = token.slice(0, token.lastIndexOf("."));
  const sig = token.slice(token.lastIndexOf(".") + 1);
  const broken = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  return `${body}.${broken}`;
}

/** サーバと同じ「日本時間のきょう」 */
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** カード 1 枚ぶんのボディ。eventId は毎回新しい UUID */
function cardBody({ eventId = crypto.randomUUID(), wordId = WORD_1 } = {}) {
  return { eventId, wordId };
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function post(body, { cookie, headers = {}, method = "POST", raw } = {}) {
  return fetch(`${baseUrl}${ENDPOINT}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `efk_session=${cookie}` } : {}),
      ...headers,
    },
    body: method === "GET" || method === "HEAD" ? undefined : (raw ?? JSON.stringify(body)),
  });
}

async function contentFile(uid) {
  return path.join(contentDir, `${uid}.json`);
}

async function readContent(uid) {
  try {
    return JSON.parse(await readFile(await contentFile(uid), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** 保存された進捗（無ければ null） */
async function readProgress(uid) {
  const content = await readContent(uid);
  return content?.data?.progress ?? null;
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-cards-test-"));
  contentDir = path.join(dataDir, "content");
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [USER_A, USER_B].map((id) => ({
        id,
        displayName: id === USER_A ? "Alpha" : "Bravo",
        avatar: "fox",
        color: "#7dd3fc",
        credentials: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
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

describe("未認証は 401 で、進捗ファイルも書かれない", () => {
  test("cookie 無し", async () => {
    const res = await post(cardBody());
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
    assert.equal(await readContent(USER_B), null);
  });

  test("改ざんされた cookie", async () => {
    const res = await post(cardBody(), { cookie: tamperedCookie(USER_A) });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("期限切れの cookie", async () => {
    const res = await post(cardBody(), { cookie: sessionCookie(USER_A, { expired: true }) });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("401 のレスポンスに内部情報を含まない", async () => {
    const res = await post(cardBody());
    const text = await res.text();
    assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+|at .*\(.*:\d+:\d+\)/);
  });
});

describe("ログイン済みなら自分の進捗だけに書く", () => {
  test("正常系で当日と単語別のカード回数が増える", async () => {
    const res = await post(cardBody({ wordId: WORD_1 }), { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.day, todayKey());
    assert.equal(body.views, 1);
    assert.equal(body.wordViews, 1);

    const progress = await readProgress(USER_A);
    assert.deepEqual(progress.days[todayKey()].cards, { views: 1 });
    assert.deepEqual(progress.cards[WORD_1].views, 1);
    /* カードはクイズの正誤を汚さない */
    assert.deepEqual(progress.words, {});
    assert.deepEqual(progress.days[todayKey()].quiz, { rounds: 0, correct: 0, total: 0 });
  });

  test("ボディの userId は無視される (IDOR 防止)", async () => {
    const res = await post(
      { ...cardBody({ wordId: WORD_2 }), userId: USER_B },
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 200);

    const a = await readContent(USER_A);
    assert.equal(a.userId, USER_A);
    assert.ok(a.data.progress);
    await assert.rejects(stat(await contentFile(USER_B)));
    assert.equal(await readContent(USER_B), null);
  });

  test("同じ eventId を 2 回送っても加算されない", async () => {
    const body = cardBody({ wordId: WORD_1 });

    const first = await post(body, { cookie: sessionCookie(USER_A) });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).duplicate, false);
    const before = await readProgress(USER_A);

    const second = await post(body, { cookie: sessionCookie(USER_A) });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.deepEqual((await readProgress(USER_A)).days[todayKey()].cards, before.days[todayKey()].cards);
    assert.deepEqual((await readProgress(USER_A)).cards[WORD_1], before.cards[WORD_1]);
  });

  test("別の eventId なら同じ単語も数える", async () => {
    const before = (await readProgress(USER_A)).cards[WORD_2]?.views ?? 0;
    const res = await post(cardBody({ wordId: WORD_2 }), { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
    assert.equal((await readProgress(USER_A)).cards[WORD_2].views, before + 1);
  });

  test("連打 (並列) でも取りこぼさず、二重送信は 1 回だけ数える", async () => {
    const cookie = sessionCookie(USER_A);
    const before = (await readProgress(USER_A)).days[todayKey()].cards.views;

    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    /* 同じ ID を 2 回ずつ、8 リクエストを同時に投げる */
    const bodies = [...ids, ...ids].map((eventId) => cardBody({ eventId, wordId: WORD_1 }));
    await Promise.all(bodies.map((body) => post(body, { cookie })));

    const after = (await readProgress(USER_A)).days[todayKey()].cards.views;
    assert.equal(after, before + ids.length);
  });
});

describe("ホワイトリスト検証 (カード閲覧)", () => {
  const cases = [
    ["eventId が無い", () => { const b = cardBody(); delete b.eventId; return b; }],
    ["eventId が UUID でない", () => ({ ...cardBody(), eventId: "not-a-uuid" })],
    ["eventId が数値", () => ({ ...cardBody(), eventId: 42 })],
    ["eventId がパス風", () => ({ ...cardBody(), eventId: "../../users" })],
    ["wordId が無い", () => { const b = cardBody(); delete b.wordId; return b; }],
    ["wordId が存在しない", () => ({ ...cardBody(), wordId: "animals/dragon" })],
    ["wordId がパス風", () => ({ ...cardBody(), wordId: "../../users" })],
    ["wordId が数値", () => ({ ...cardBody(), wordId: 42 })],
  ];

  for (const [label, make] of cases) {
    test(`${label} は 400`, async () => {
      const res = await post(make(), { cookie: sessionCookie(USER_A) });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+/);
    });
  }

  test("壊れた JSON / 配列は 400", async () => {
    for (const raw of ["{oops", "[]", '"x"']) {
      const res = await post(null, { cookie: sessionCookie(USER_A), raw });
      assert.equal(res.status, 400);
    }
  });

  test("GET は 405 (記録専用)", async () => {
    const res = await post(null, { cookie: sessionCookie(USER_A), method: "GET" });
    assert.equal(res.status, 405);
  });

  test("2KB を超えるボディは 413", async () => {
    const res = await post(null, {
      cookie: sessionCookie(USER_A),
      raw: JSON.stringify({ eventId: crypto.randomUUID(), wordId: WORD_1, pad: "x".repeat(2048) }),
    });
    assert.equal(res.status, 413);
  });
});
