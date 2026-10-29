import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * 発音結果 API の認可テスト — issue #32
 *
 * 「セッションから uid を取る」という主張を**テストで固定する**ためのもの。
 * 実サーバ (`next start`) を一時データディレクトリで起動し、HTTP 越しに叩く。
 * 単体テストでは「レイアウトの保護外」「cookie の改ざん」を再現できないため、
 * ここは統合テストで確かめる。
 *
 * 実行: npm run test:api  (事前に npm run build が必要)
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";
const USER_B = "u_bravo000000000000";

const ENDPOINT = "/api/pronunciation/attempt";
const VALID_WORD = "animals/dog";

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
  return signToken({ uid, iat: now - 60, exp: expired ? now - 10 : now + 3600 });
}

/** 末尾の署名を壊した cookie (フォーマットは正しい = 改ざんされた状態) */
function tamperedCookie(uid) {
  const token = sessionCookie(uid);
  const [body, sig] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
  const broken = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  return `${body}.${broken}`;
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
      const res = await fetch(`${baseUrl}/api/auth/me`);
      if (res.ok) break;
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

describe("未認証は 401 で、ファイルも書かれない", () => {
  test("cookie 無し", async () => {
    const res = await post({ wordId: VALID_WORD, score: "ok" });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
    assert.equal(await readContent(USER_B), null);
  });

  test("改ざんされた cookie", async () => {
    const res = await post({ wordId: VALID_WORD, score: "ok" }, { cookie: tamperedCookie(USER_A) });
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("期限切れの cookie", async () => {
    const res = await post(
      { wordId: VALID_WORD, score: "ok" },
      { cookie: sessionCookie(USER_A, { expired: true }) },
    );
    assert.equal(res.status, 401);
    assert.equal(await readContent(USER_A), null);
  });

  test("存在しないユーザーの cookie", async () => {
    const res = await post({ wordId: VALID_WORD, score: "ok" }, { cookie: sessionCookie("u_ghost") });
    assert.equal(res.status, 401);
  });

  test("401 のレスポンスに内部情報を含まない", async () => {
    const res = await post({ wordId: VALID_WORD, score: "ok" });
    const text = await res.text();
    assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+|at .*\(.*:\d+:\d+\)/);
  });
});

describe("ログイン済みなら自分のファイルだけに書く", () => {
  test("正常系", async () => {
    const res = await post({ wordId: VALID_WORD, score: "ok" }, { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.wordId, VALID_WORD);
    assert.equal(body.score, "ok");
    assert.equal(body.attempts, 1);

    const content = await readContent(USER_A);
    assert.ok(content, "A のファイルが作られる");
    assert.equal(content.data.pronunciation.byWord[VALID_WORD].score, "ok");
    assert.equal(content.data.pronunciation.byWord[VALID_WORD].attempts, 1);
    assert.equal(content.data.pronunciation.totalAttempts, 1);
  });

  test("ボディの userId は無視される (IDOR 防止)", async () => {
    const res = await post(
      { wordId: "food/apple", score: "close", userId: USER_B },
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 200);

    const a = await readContent(USER_A);
    assert.equal(a.data.pronunciation.byWord["food/apple"].score, "close");
    assert.equal(a.userId, USER_A);

    // 他人 (B) のファイルは作られない
    assert.equal(await readContent(USER_B), null);
    await assert.rejects(stat(await contentFile(USER_B)));
  });

  test("試行回数が積み上がる", async () => {
    await post({ wordId: VALID_WORD, score: "retry" }, { cookie: sessionCookie(USER_A) });
    const content = await readContent(USER_A);
    assert.equal(content.data.pronunciation.byWord[VALID_WORD].attempts, 2);
    assert.equal(content.data.pronunciation.byWord[VALID_WORD].score, "retry");
    assert.equal(content.data.pronunciation.totalAttempts, 3);
  });

  test("同じ子の連打で更新が取りこぼされない (直列化)", async () => {
    const cookie = sessionCookie(USER_A);
    const before = (await readContent(USER_A)).data.pronunciation.totalAttempts;
    await Promise.all(
      Array.from({ length: 5 }, () => post({ wordId: "food/banana", score: "ok" }, { cookie })),
    );
    const after = (await readContent(USER_A)).data.pronunciation.totalAttempts;
    assert.equal(after, before + 5);
  });
});

describe("ホワイトリスト検証", () => {
  const cases = [
    ["words.ts に無い単語 ID", { wordId: "animals/dragon", score: "ok" }],
    ["単語 ID が文字列でない", { wordId: 42, score: "ok" }],
    ["単語 ID がパス風", { wordId: "../../users", score: "ok" }],
    ["スコアが 3 値以外", { wordId: VALID_WORD, score: "perfect" }],
    ["スコアが数値", { wordId: VALID_WORD, score: 3 }],
    ["フィールド欠落", {}],
  ];

  for (const [label, body] of cases) {
    test(`${label} は 400`, async () => {
      const res = await post(body, { cookie: sessionCookie(USER_A) });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.doesNotMatch(text, /\/home\/|node_modules|\.ts:\d+/);
    });
  }

  test("壊れた JSON は 400", async () => {
    const res = await post(null, { cookie: sessionCookie(USER_A), raw: '{"wordId":' });
    assert.equal(res.status, 400);
  });

  test("巨大なボディは 413", async () => {
    const res = await post(
      { wordId: VALID_WORD, score: "ok", pad: "x".repeat(64 * 1024) },
      { cookie: sessionCookie(USER_A) },
    );
    assert.equal(res.status, 413);
  });
});

describe("その他", () => {
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
