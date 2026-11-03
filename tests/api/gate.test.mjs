import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * 認可の入口 (proxy.ts / gate.ts) の統合テスト — issue #54
 *
 * 単体テスト (`tests/unit/gate.test.mjs`) は判定関数を見るだけで、
 * **リクエストが本当に門番を通るか** は分からない。ここでは実サーバを立てて
 * HTTP 越しに確かめる。
 *
 * 特に大事なのは最後の「存在しない API も 401」:
 * 404 ではなく 401 が返る = ルーティングより先に認可の判断が走っている証拠。
 * つまり **今後どんな API を足しても、allowlist に書かない限り守られる**。
 *
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";

let baseUrl;
let server;
let dataDir;

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function sessionCookie(uid) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ uid, iat: now - 60, exp: now + 3600 });
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function get(pathname, { cookie, redirect = "manual" } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    redirect,
    headers: cookie ? { cookie: `efk_session=${cookie}` } : {},
  });
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-gate-test-"));
  await mkdir(path.join(dataDir, "content"), { recursive: true });
  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [
        {
          id: USER_A,
          displayName: "Alpha",
          avatar: "fox",
          color: "#7dd3fc",
          credentials: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
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

after(() => {
  server?.kill("SIGTERM");
});

describe("default-deny — allowlist に無い経路は閉じている", () => {
  test("存在しない API でさえ 401 (404 より先に認可が走る)", async () => {
    const res = await get("/api/this-endpoint-does-not-exist");
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  test("個人情報を返す API は未ログインで 401", async () => {
    for (const p of ["/api/auth/me", "/api/pronunciation/attempt"]) {
      const res = await get(p);
      assert.equal(res.status, 401, `${p} が閉じていない`);
    }
  });

  test("削除した /api/auth/users は復活していない", async () => {
    const res = await get("/api/auth/users");
    assert.notEqual(res.status, 200);
  });

  test("HTML は /login へリダイレクト", async () => {
    for (const p of ["/", "/quiz", "/flashcards", "/pronunciation", "/build"]) {
      const res = await get(p);
      assert.equal(res.status, 307, `${p} が閉じていない`);
      assert.match(res.headers.get("location") ?? "", /\/login$/);
    }
  });

  test("改ざんされた cookie は通らない", async () => {
    const token = sessionCookie(USER_A);
    const body = token.slice(0, token.lastIndexOf("."));
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const broken = `${body}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    const res = await get("/api/auth/me", { cookie: broken });
    assert.equal(res.status, 401);
  });

  test("期限切れの cookie は通らない", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signToken({ uid: USER_A, iat: now - 7200, exp: now - 10 });
    const res = await get("/api/auth/me", { cookie: expired });
    assert.equal(res.status, 401);
  });

  test("pool に居ないユーザーの cookie は通らない", async () => {
    const res = await get("/api/auth/me", { cookie: sessionCookie("u_ghost0000000000000") });
    assert.equal(res.status, 401);
  });
});

describe("公開経路は通る", () => {
  test("/login は未ログインで開ける", async () => {
    const res = await get("/login");
    assert.equal(res.status, 200);
  });

  test("ログイン手続きの API は未ログインで到達できる", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // 認可で 401 にされず、ハンドラの判断 (400 など) まで到達している
    assert.notEqual(res.status, 401);
  });

  test("正しいセッションなら保護ページが開く", async () => {
    const res = await get("/", { cookie: sessionCookie(USER_A) });
    assert.equal(res.status, 200);
  });
});
