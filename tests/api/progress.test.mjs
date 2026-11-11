import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * クイズ結果の記録 API — issue #65
 *
 * 固定したい主張:
 *  1. 未ログインでは**何も書かない** (userId はセッションからのみ = IDOR 不可)
 *  2. 同じ `roundId` の再送で数字が水増しされない (冪等キー)
 *  3. 単語 ID・レベル・件数はホワイトリストで弾く (壊れたボディは 400)
 *  4. 集計は当日ぶんだけを返し、内部パスやスタックトレースは漏らさない
 *
 * 実サーバ (`next start`) を一時データディレクトリで起動し、HTTP 越しに叩く。
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";
const USER_B = "u_bravo000000000000";

const ENDPOINT = "/api/progress/quiz";
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

/**
 * クイズの送信ボディ。roundId は毎回新しい UUID。
 * 1 問ごとに「その時点までの回答」を送る形 (#76) なので、results は 1〜8 件。
 */
function roundBody({ roundId = crypto.randomUUID(), level = "beginner", results } = {}) {
  return {
    roundId,
    level,
    results: results ?? [
      { wordId: WORD_1, correct: true },
      { wordId: WORD_2, correct: false },
      { wordId: null, correct: true },
    ],
  };
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
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-progress-test-"));
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
      /* 認可の入口 (proxy) が入ったので未ログインは 401。
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

describe("未認証は 401 で、進捗ファイルも書かれない", () => {
  test("cookie 無し", async () => {
    const res = await post(roundBody());
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
    assert.equal(await readContent(USER_B), null);
  });

  test("改ざんされた cookie", async () => {
    const res = await post(roundBody(), { cookie: tamperedCookie(USER_A) });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("期限切れの cookie", async () => {
    const res = await post(roundBody(), { cookie: sessionCookie(USER_A, { expired: true }) });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("存在しないユーザーの cookie", async () => {
    const res = await post(roundBody(), { cookie: sessionCookie("u_ghost") });
    assert.equal(res.status, 401);
  });

  test("401 のレスポンスに内部情報を含まない", async () => {
    const res = await post(roundBody());
    const text = await res.text();
    assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+|at .*\(.*:\d+:\d+\)/);
  });
});

describe("ログイン済みなら自分の進捗だけに書く", () => {
  test("正常系で当日の集計が増える", async () => {
    const res = await post(roundBody(), { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.day, todayKey());
    /* 8 問そろっていないのでラウンドはまだ数えない。回答は記録される */
    assert.equal(body.rounds, 0);
    assert.equal(body.correct, 2);
    assert.equal(body.total, 3);

    const progress = await readProgress(USER_A);
    assert.ok(progress, "A のファイルが作られる");
    assert.deepEqual(progress.days[todayKey()].quiz, { rounds: 0, correct: 2, total: 3 });
    /* 単語あり 2 件だけが単語別に入る (wordId: null は数えない) */
    assert.equal(progress.words[WORD_1].correct, 1);
    assert.equal(progress.words[WORD_2].wrong, 1);
    assert.equal(Object.keys(progress.words).length, 2);
  });

  test("ボディの userId は無視される (IDOR 防止)", async () => {
    const res = await post(
      { ...roundBody(), userId: USER_B },
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 200);

    const a = await readContent(USER_A);
    assert.equal(a.userId, USER_A);
    assert.ok(a.data.progress);
    /* 他人 (B) のファイルは作られない */
    await assert.rejects(stat(await contentFile(USER_B)));
    assert.equal(await readContent(USER_B), null);
  });

  test("中級・上級 (wordId: null) でも日次は数える", async () => {
    const saved = await readProgress(USER_A);
    const before = saved.days[todayKey()].quiz;
    const wordsBefore = saved.words;
    const res = await post(
      roundBody({
        level: "advanced",
        results: [
          { wordId: null, correct: true },
          { wordId: null, correct: true },
        ],
      }),
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 200);

    const body = await res.json();
    /* 文法問題だけの途中送信でも、ラウンドは数えず回答だけ数える */
    assert.equal(body.rounds, before.rounds);
    assert.equal(body.correct, before.correct + 2);
    assert.equal(body.total, before.total + 2);
    /* 文法問題は単語別の集計を汚さない */
    assert.deepEqual((await readProgress(USER_A)).words, wordsBefore);
  });

  test("同じ roundId を 2 回送っても加算されない", async () => {
    const roundId = crypto.randomUUID();
    const body = roundBody({ roundId });

    const first = await post(body, { cookie: sessionCookie(USER_A) });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.duplicate, false);

    const saved = await readProgress(USER_A);
    const quiz = saved.days[todayKey()].quiz;

    const second = await post(body, { cookie: sessionCookie(USER_A) });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    /* 2 回目は「成功」だが数字は据え置き */
    assert.deepEqual(
      { rounds: secondBody.rounds, correct: secondBody.correct, total: secondBody.total },
      { rounds: quiz.rounds, correct: quiz.correct, total: quiz.total },
    );
    assert.deepEqual((await readProgress(USER_A)).days[todayKey()].quiz, quiz);
    /* 回答の冪等キーは 3 問ぶん。ラウンドは 8 問そろっていないので入らない */
    assert.deepEqual(
      saved.quizAnswerIds.filter((id) => id.startsWith(`${roundId}:`)),
      [`${roundId}:2`, `${roundId}:1`, `${roundId}:0`],
    );
    assert.equal(saved.quizRoundIds.includes(roundId), false);
  });

  test("連打 (並列) でも取りこぼさず、二重送信は 1 回だけ数える", async () => {
    const cookie = sessionCookie(USER_A);
    const before = (await readProgress(USER_A)).days[todayKey()].quiz.total;

    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    /* 同じ ID を 2 回ずつ、8 リクエストを同時に投げる */
    const bodies = [...ids, ...ids].map((roundId) => roundBody({ roundId }));
    await Promise.all(bodies.map((body) => post(body, { cookie })));

    const after = (await readProgress(USER_A)).days[todayKey()].quiz.total;
    assert.equal(after, before + ids.length * 3);
  });

  test("1 問ごとに送っても二重に数えず、8 問でラウンドが 1 回増える", async () => {
    const cookie = sessionCookie(USER_A);
    const roundId = crypto.randomUUID();
    const answers = Array.from({ length: 8 }, (_, i) => ({
      answerId: crypto.randomUUID(),
      wordId: i === 0 ? WORD_1 : null,
      correct: i % 2 === 0,
    }));

    const before = (await readProgress(USER_A)).days[todayKey()].quiz;

    /* 1 問ずつ、その時点までの回答をまとめて送る (実画面と同じ) */
    for (let i = 0; i < answers.length; i += 1) {
      const res = await post(
        { roundId, level: "beginner", results: answers.slice(0, i + 1) },
        { cookie },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.total, before.total + i + 1);
      /* 8 問そろうまではラウンドを数えない */
      assert.equal(body.rounds, i + 1 === answers.length ? before.rounds + 1 : before.rounds);
    }

    /* 最後の送信の再送 (二重タップ) は増えない */
    const last = await post({ roundId, level: "beginner", results: answers }, { cookie });
    const lastBody = await last.json();
    assert.equal(lastBody.duplicate, true);
    assert.equal(lastBody.total, before.total + answers.length);
    assert.equal(lastBody.rounds, before.rounds + 1);

    const saved = (await readProgress(USER_A)).days[todayKey()].quiz;
    assert.deepEqual(saved, {
      rounds: before.rounds + 1,
      correct: before.correct + answers.filter((a) => a.correct).length,
      total: before.total + answers.length,
    });
  });
});

describe("ホワイトリスト検証 (クイズ結果)", () => {
  const base = () => roundBody({ roundId: crypto.randomUUID() });

  const cases = [
    ["roundId が無い", () => { const b = base(); delete b.roundId; return b; }],
    ["roundId が UUID でない", () => ({ ...base(), roundId: "not-a-uuid" })],
    ["roundId が数値", () => ({ ...base(), roundId: 42 })],
    ["roundId がパス風", () => ({ ...base(), roundId: "../../users" })],
    ["level が 3 値以外", () => ({ ...base(), level: "expert" })],
    ["level が欠落", () => { const b = base(); delete b.level; return b; }],
    ["results が配列でない", () => ({ ...base(), results: { wordId: WORD_1, correct: true } })],
    ["results が空", () => ({ ...base(), results: [] })],
    [
      "results が 9 件 (QUIZ_LENGTH 超え)",
      () => ({ ...base(), results: Array.from({ length: 9 }, () => ({ wordId: null, correct: true })) }),
    ],
    ["correct が真偽値でない", () => ({ ...base(), results: [{ wordId: WORD_1, correct: "yes" }] })],
    [
      "answerId が UUID でない",
      () => ({ ...base(), results: [{ answerId: "not-a-uuid", wordId: WORD_1, correct: true }] }),
    ],
    ["wordId が存在しない", () => ({ ...base(), results: [{ wordId: "animals/dragon", correct: true }] })],
    ["wordId がパス風", () => ({ ...base(), results: [{ wordId: "../../users", correct: true }] })],
    ["wordId が数値", () => ({ ...base(), results: [{ wordId: 42, correct: true }] })],
    ["結果がオブジェクトでない", () => ({ ...base(), results: ["ok"] })],
  ];

  for (const [label, make] of cases) {
    test(`${label} は 400`, async () => {
      const res = await post(make(), { cookie: sessionCookie(USER_A) });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+/);
    });
  }

  test("壊れた JSON は 400", async () => {
    const res = await post(null, { cookie: sessionCookie(USER_A), raw: '{"roundId":' });
    assert.equal(res.status, 400);
  });

  test("巨大なボディは 413", async () => {
    const res = await post(
      { ...base(), pad: "x".repeat(64 * 1024) },
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 413);
  });

  test("400 を返しても進捗は変わらない", async () => {
    const before = await readProgress(USER_A);
    await post({ ...base(), level: "expert" }, { cookie: sessionCookie(USER_A) });
    assert.deepEqual(await readProgress(USER_A), before);
  });
});

describe("その他 (クイズ記録)", () => {
  test("GET は 405", async () => {
    const res = await post(null, { cookie: sessionCookie(USER_A), method: "GET" });
    assert.equal(res.status, 405);
  });

  test("保存先は AUTH_DATA_DIR の中だけ", async () => {
    const content = await readContent(USER_A);
    assert.equal(content.userId, USER_A);
    assert.ok((await stat(contentDir)).isDirectory());
  });
});
