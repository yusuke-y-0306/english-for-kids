import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

import { encryptSecret } from "../../src/lib/auth/crypto.ts";

/**
 * 「新しい端末で URL を開いただけで 家族の なまえが 見える」のを防ぐ — の仕様。
 *
 * - 端末の cookie (efk_device) が 無い ログイン画面には こどもの なまえを 出さない
 * - なまえの 一覧は おうちの 合言葉を 確かめた あとだけ返す
 * - パスキーが ある 端末は なまえ無しで ログインできる (userless)
 *
 * 実行: npm run test:api  (事前に npm run build が必要)
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const MASTER_KEY = randomBytes(32).toString("base64");
const FAMILY = "legacy-passphrase";
const USER_ID = "u_legacy000000000000";
const CHILD_NAME = "ゆうすけ";

let baseUrl;
let server;
let dataDir;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function deviceCookie(uids) {
  const now = Math.floor(Date.now() / 1000);
  return `efk_device=${sign({ uids, exp: now + 3600 })}`;
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function post(pathname, body, cookie) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-device-test-"));
  const now = new Date().toISOString();
  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: now,
      familySecret: encryptSecret(
        JSON.stringify({ guardianPassphrase: FAMILY }),
        Buffer.from(MASTER_KEY, "base64"),
      ),
      users: [
        {
          id: USER_ID,
          displayName: CHILD_NAME,
          avatar: "🐸",
          color: "#fff",
          credentials: [
            { id: "cred-abc", publicKey: "AAAA", counter: 0, createdAt: now },
          ],
          createdAt: now,
          updatedAt: now,
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
        USERPOOL_MASTER_KEY: MASTER_KEY,
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
      const res = await fetch(`${baseUrl}/login`);
      if (res.status) break;
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

describe("はじめての端末", () => {
  test("ログイン画面に こどもの なまえを 出さない", async () => {
    const html = await (await fetch(`${baseUrl}/login`)).text();
    assert.doesNotMatch(html, new RegExp(CHILD_NAME), "知らない端末に なまえを 見せない");
    assert.match(html, /はじめての たんまつ/);
  });

  test("なまえの 一覧は 合言葉を 確かめた あとだけ", async () => {
    const wrong = await post("/api/auth/setup/children", { guardianPassphrase: "nope" });
    assert.equal(wrong.status, 403);

    const ok = await post("/api/auth/setup/children", { guardianPassphrase: FAMILY });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].displayName, CHILD_NAME);
  });

  test("なまえ無しで パスキー ログインを 開始できる", async () => {
    const res = await post("/api/auth/login/options", { usernameless: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.options.allowCredentials, [], "端末の パスキーを そのまま使う");
    assert.ok(body.options.challenge);
  });
});

describe("つかったことのある端末", () => {
  test("その こどもだけを ログイン画面に 出す", async () => {
    const res = await fetch(`${baseUrl}/login`, { headers: { cookie: deviceCookie([USER_ID]) } });
    const html = await res.text();
    assert.match(html, new RegExp(CHILD_NAME));
  });

  test("覚えの無い ID の cookie では なまえを 出さない", async () => {
    const res = await fetch(`${baseUrl}/login`, {
      headers: { cookie: deviceCookie(["u_someone_else"]) },
    });
    const html = await res.text();
    assert.doesNotMatch(html, new RegExp(CHILD_NAME));
  });

  test("署名が こわれた cookie は 無視する", async () => {
    const token = deviceCookie([USER_ID]).replace(/efk_device=/, "");
    const [body, sig] = token.split(".");
    const broken = `${body}.${sig.slice(0, -2)}${sig.slice(-2) === "AA" ? "BB" : "AA"}`;
    const res = await fetch(`${baseUrl}/login`, { headers: { cookie: `efk_device=${broken}` } });
    assert.doesNotMatch(await res.text(), new RegExp(CHILD_NAME));
  });
});
