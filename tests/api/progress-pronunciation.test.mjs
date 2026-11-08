import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * 発音の記録を進捗の日次集計に取り込む — issue #66 (親: #4 進捗管理)
 *
 * 固定したい主張:
 *  1. 発音を 1 回記録すると、**同じ書き込みで** 進捗の当日 `pronunciation` が +1 される
 *     (2 回ファイルを書かない = 片方だけ書けた状態が作れない)
 *  2. 既存ユーザー (発音ストアしか持っていない子) の単語別の状態が `words[]` に
 *     **初回だけ** 種まきされ、2 回目以降は増えない (二重計上しない)
 *  3. クイズで既に数えている単語には種を蒔かない (同じ事実を 2 か所で数えない)
 *  4. 累計の正は `pronunciation.totalAttempts`、日次は `progress.days`。
 *     移行で遡及できないのは日次だけ (docs に明記)
 *
 * 実サーバ (`next start`) を一時データディレクトリで起動し、HTTP 越しに叩く。
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
/** 発音の履歴だけを持つ既存ユーザー */
const USER_MIGRATING = "u_migrating000000000";
/** クイズの履歴も持つ既存ユーザー */
const USER_WITH_QUIZ = "u_quiz000000000000";
/** まっさらな新規ユーザー */
const USER_FRESH = "u_fresh000000000000";

const ENDPOINT = "/api/pronunciation/attempt";
const OK_WORD = "animals/dog";
const RETRY_WORD = "food/apple";
const NEW_WORD = "food/banana";

/** 機能を入れる前の履歴 (固定値)。日次は残っていない = 遡及できない */
const LEGACY_AT = "2026-11-01T00:00:00.000Z";
const LEGACY_PRONUNCIATION = {
  version: 1,
  totalAttempts: 5,
  lastAttemptAt: LEGACY_AT,
  byWord: {
    [OK_WORD]: { score: "ok", attempts: 3, updatedAt: LEGACY_AT },
    [RETRY_WORD]: { score: "retry", attempts: 2, updatedAt: LEGACY_AT },
  },
};

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

/** サーバと同じ「日本時間のきょう」 */
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function post(body, { cookie, method = "POST" } = {}) {
  return fetch(`${baseUrl}${ENDPOINT}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `efk_session=${cookie}` } : {}),
    },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

async function readContent(uid) {
  try {
    return JSON.parse(await readFile(path.join(contentDir, `${uid}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readProgress(uid) {
  return (await readContent(uid))?.data?.progress ?? null;
}

async function readPronunciation(uid) {
  return (await readContent(uid))?.data?.pronunciation ?? null;
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-api-test-"));
  contentDir = path.join(dataDir, "content");
  await mkdir(contentDir, { recursive: true });

  const users = [USER_MIGRATING, USER_WITH_QUIZ, USER_FRESH];
  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      users: users.map((id) => ({
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

  /* 既存ユーザー: 発音の履歴だけがある (進捗キーはまだ無い) */
  await writeFile(
    path.join(contentDir, `${USER_MIGRATING}.json`),
    JSON.stringify({
      userId: USER_MIGRATING,
      visits: 12,
      data: { pronunciation: LEGACY_PRONUNCIATION },
    }),
  );

  /* クイズの履歴も持つ子: OK_WORD は既にクイズで数えている */
  await writeFile(
    path.join(contentDir, `${USER_WITH_QUIZ}.json`),
    JSON.stringify({
      userId: USER_WITH_QUIZ,
      visits: 4,
      data: {
        pronunciation: LEGACY_PRONUNCIATION,
        progress: {
          version: 1,
          days: {},
          words: { [OK_WORD]: { correct: 1, wrong: 1, lastAt: LEGACY_AT } },
          quizRoundIds: [],
          longestStreak: 0,
          lastStudyAt: LEGACY_AT,
          updatedAt: LEGACY_AT,
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

describe("未認証では進捗も発音も書かれない", () => {
  test("cookie 無し", async () => {
    const before = await readContent(USER_MIGRATING);
    const res = await post({ wordId: NEW_WORD, score: "ok" });
    assert.equal(res.status, 401);
    /* 既存ユーザーのファイルは 1 バイトも変わらない */
    assert.deepEqual(await readContent(USER_MIGRATING), before);
    assert.equal(await readContent(USER_FRESH), null);
  });
});

describe("発音 1 回が進捗の日次に入る (#66)", () => {
  test("既存ユーザー (発音のみ) の試行が「きょう」として反映される", async () => {
    const res = await post({ wordId: NEW_WORD, score: "ok" }, { cookie: sessionCookie(USER_MIGRATING) });
    assert.equal(res.status, 200);

    const progress = await readProgress(USER_MIGRATING);
    assert.ok(progress, "進捗キーが同じ書き込みで作られる");
    assert.deepEqual(progress.days[todayKey()].pronunciation, { attempts: 1, ok: 1 });
    /* 発音は単語別の正誤を触らない (単語別の正は発音ストア) */
    assert.equal(progress.words[NEW_WORD], undefined);
    /* クイズの日次は 0 のまま (発音で汚さない) */
    assert.deepEqual(progress.days[todayKey()].quiz, { rounds: 0, correct: 0, total: 0 });
  });

  test("同じ書き込みで発音ストアも 1 回だけ増える", async () => {
    const pronunciation = await readPronunciation(USER_MIGRATING);
    assert.equal(pronunciation.totalAttempts, LEGACY_PRONUNCIATION.totalAttempts + 1);
    assert.equal(pronunciation.byWord[NEW_WORD].attempts, 1);
    assert.equal(pronunciation.byWord[OK_WORD].attempts, 3, "他の単語は据え置き");
  });

  test("ok 以外は attempts だけ増え、ok には数えない", async () => {
    const res = await post({ wordId: NEW_WORD, score: "close" }, { cookie: sessionCookie(USER_MIGRATING) });
    assert.equal(res.status, 200);

    const progress = await readProgress(USER_MIGRATING);
    assert.deepEqual(progress.days[todayKey()].pronunciation, { attempts: 2, ok: 1 });
  });

  test("累計 (発音ストア) と日次 (進捗) が食い違わない", async () => {
    const progress = await readProgress(USER_MIGRATING);
    const pronunciation = await readPronunciation(USER_MIGRATING);

    /* 移行では日次を遡及できないので「移行後に叩いた回数」と一致する */
    const attemptsToday = Object.values(progress.days).reduce((sum, day) => sum + day.pronunciation.attempts, 0);
    assert.equal(attemptsToday, 2);
    assert.equal(pronunciation.totalAttempts, LEGACY_PRONUNCIATION.totalAttempts + attemptsToday);
  });

  test("GET は 405 で、日次も増えない", async () => {
    const before = await readProgress(USER_MIGRATING);
    const res = await post(null, { cookie: sessionCookie(USER_MIGRATING), method: "GET" });
    assert.equal(res.status, 405);
    assert.deepEqual(await readProgress(USER_MIGRATING), before);
  });
});

describe("既存ユーザーの移行 (種まきは 1 回だけ)", () => {
  test("byWord から単語別の種が蒔かれ、印が立つ", async () => {
    const progress = await readProgress(USER_MIGRATING);

    /* 直近が ok なら全回を正解、それ以外は全回を不正解として蒔く (近似) */
    assert.deepEqual(progress.words[OK_WORD], { correct: 3, wrong: 0, lastAt: LEGACY_AT });
    assert.deepEqual(progress.words[RETRY_WORD], { correct: 0, wrong: 2, lastAt: LEGACY_AT });
    assert.equal(progress.migratedFromPronunciation, true);
  });

  test("2 回目以降は種まきしない (数字が水増しされない)", async () => {
    const before = await readProgress(USER_MIGRATING);
    const res = await post({ wordId: OK_WORD, score: "ok" }, { cookie: sessionCookie(USER_MIGRATING) });
    assert.equal(res.status, 200);

    const after = await readProgress(USER_MIGRATING);
    /* 単語別は据え置き (発音の 4 回目を correct に足さない) */
    assert.deepEqual(after.words[OK_WORD], before.words[OK_WORD]);
    /* 日次だけが +1 される */
    assert.equal(after.days[todayKey()].pronunciation.attempts, 3);
    assert.equal(after.days[todayKey()].pronunciation.ok, 2);
  });

  test("クイズで数えている単語には種を蒔かない (二重計上しない)", async () => {
    const res = await post({ wordId: RETRY_WORD, score: "ok" }, { cookie: sessionCookie(USER_WITH_QUIZ) });
    assert.equal(res.status, 200);

    const progress = await readProgress(USER_WITH_QUIZ);
    /* OK_WORD はクイズの 1 勝 1 敗のまま (発音の 3 回は足さない) */
    assert.deepEqual(progress.words[OK_WORD], { correct: 1, wrong: 1, lastAt: LEGACY_AT });
    /* クイズに無い単語だけが蒔かれる */
    assert.deepEqual(progress.words[RETRY_WORD], { correct: 0, wrong: 2, lastAt: LEGACY_AT });
    assert.deepEqual(progress.days[todayKey()].pronunciation, { attempts: 1, ok: 1 });
  });

  test("新規ユーザーは種が無く、印だけ立つ (落ちない)", async () => {
    const res = await post({ wordId: NEW_WORD, score: "ok" }, { cookie: sessionCookie(USER_FRESH) });
    assert.equal(res.status, 200);

    const progress = await readProgress(USER_FRESH);
    assert.deepEqual(progress.words, {});
    assert.equal(progress.migratedFromPronunciation, true);
    assert.deepEqual(progress.days[todayKey()].pronunciation, { attempts: 1, ok: 1 });
  });
});

describe("連打しても取りこぼさない", () => {
  test("並列 5 回で発音も日次も +5 (直列化)", async () => {
    const cookie = sessionCookie(USER_FRESH);
    const beforePronunciation = (await readPronunciation(USER_FRESH)).totalAttempts;
    const beforeDay = (await readProgress(USER_FRESH)).days[todayKey()].pronunciation;

    await Promise.all(
      Array.from({ length: 5 }, () => post({ wordId: NEW_WORD, score: "ok" }, { cookie })),
    );

    const pronunciation = await readPronunciation(USER_FRESH);
    const day = (await readProgress(USER_FRESH)).days[todayKey()].pronunciation;
    assert.equal(pronunciation.totalAttempts, beforePronunciation + 5);
    assert.equal(day.attempts, beforeDay.attempts + 5);
    assert.equal(day.ok, beforeDay.ok + 5);
    /* 単語別は 1 回目の試行の 1 回だけ (新規ユーザーは種を蒔かない) */
    assert.deepEqual((await readProgress(USER_FRESH)).words, {});
  });
});
