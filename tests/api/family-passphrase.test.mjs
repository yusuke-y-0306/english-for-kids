import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

import { encryptSecret } from "../../src/lib/auth/crypto.ts";

/**
 * 「おうち 共通の合言葉」は 1 つだけ — の仕様を HTTP 越しに固定する。
 *
 * 以前は 管理者パスフレーズ (新規追加用) と 保護者パスフレーズ (端末追加用) の
 * 2 つがあり、どちらも親が覚えていなければならなかった。しかも 管理者側の値は
 * 生成されただけで 画面に一度も出てこない。守る秘密は 1 つで足りる。
 *
 * ここでは 旧形式 (ユーザーごとの秘密しか無い) プールを用意し、
 * - 新しい合言葉 1 つで 「こども追加」も「端末追加」も通ること
 * - 廃止した GUARDIAN_ADMIN_PASSPHRASE は もう効かないこと
 * - 入力ゆれ (前後の空白 / 全角) を吸収すること
 * を確かめる。
 *
 * 実行: npm run test:api  (事前に npm run build が必要)
 */

const MASTER_KEY = randomBytes(32);
const OBSOLETE_ADMIN = "amber-kite-river-44";
const FAMILY = "legacy-passphrase";
const USER_ID = "u_legacy000000000000";

let baseUrl;
let server;
let dataDir;

function encryptedSecret(passphrase) {
  return encryptSecret(JSON.stringify({ guardianPassphrase: passphrase }), MASTER_KEY);
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function post(body) {
  return fetch(`${baseUrl}/api/auth/setup/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-passphrase-test-"));
  const now = new Date().toISOString();
  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: now,
      users: [
        {
          id: USER_ID,
          displayName: "ゆうすけ",
          avatar: "🐸",
          color: "#fff",
          secret: encryptedSecret(FAMILY),
          credentials: [],
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
        SESSION_SECRET: randomBytes(32).toString("hex"),
        USERPOOL_MASTER_KEY: MASTER_KEY.toString("base64"),
        /* 廃止した変数。設定しても もう 合言葉としては 使われない */
        GUARDIAN_ADMIN_PASSPHRASE: OBSOLETE_ADMIN,
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
      const res = await fetch(`${baseUrl}/api/auth/login`);
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

describe("こどもを ふやす (mode=new)", () => {
  test("ちがう合言葉は 403 で、理由は合言葉の話しかしない", async () => {
    const res = await post({
      mode: "new",
      displayName: "たろう",
      guardianPassphrase: "definitely-wrong",
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /合言葉/);
  });

  test("廃止した管理者パスフレーズでは 通らない", async () => {
    const res = await post({
      mode: "new",
      displayName: "たろう",
      guardianPassphrase: OBSOLETE_ADMIN,
    });
    assert.equal(res.status, 403, "管理者パスフレーズは もう合言葉ではない");
  });

  test("おうち 共通の合言葉 1 つで 追加できる (入力ゆれも吸収)", async () => {
    const res = await post({
      mode: "new",
      displayName: "たろう",
      guardianPassphrase: `  ｌｅｇａｃｙ-passphrase　`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.options?.challenge, "WebAuthn の challenge が返る");
    assert.ok(body.userId);
  });
});

describe("端末を ふやす (mode=device)", () => {
  test("同じ合言葉で 通る", async () => {
    const res = await post({
      mode: "device",
      userId: USER_ID,
      guardianPassphrase: FAMILY,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.userId, USER_ID);
  });

  test("ちがう合言葉は 403", async () => {
    const res = await post({
      mode: "device",
      userId: USER_ID,
      guardianPassphrase: "nope-nope-nope",
    });
    assert.equal(res.status, 403);
  });
});

describe("保存ファイル", () => {
  test("合言葉は 平文で残らず、ユーザーごとの秘密も壊さない", async () => {
    const raw = await readFile(path.join(dataDir, "users.json"), "utf8");
    assert.doesNotMatch(raw, new RegExp(FAMILY));
    const pool = JSON.parse(raw);
    assert.equal(pool.users.length, 1, "options の時点では まだ ユーザーを増やさない");
    assert.ok(pool.users[0].secret);
  });
});

describe("忘れたときの復旧 (npm run auth:passphrase)", () => {
  test("CLI で 決め直した合言葉が そのまま通る", async () => {
    const NEW_FAMILY = "あたらしい-あいことば";
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["scripts/auth-passphrase.mjs", NEW_FAMILY],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AUTH_DATA_DIR: dataDir,
            USERPOOL_MASTER_KEY: MASTER_KEY.toString("base64"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`CLI が失敗しました:\n${log}`)),
      );
    });

    const ok = await post({ mode: "device", userId: USER_ID, guardianPassphrase: NEW_FAMILY });
    assert.equal(ok.status, 200);
    const old = await post({ mode: "device", userId: USER_ID, guardianPassphrase: FAMILY });
    assert.equal(old.status, 403, "古い合言葉は もう通らない");
  });
});
