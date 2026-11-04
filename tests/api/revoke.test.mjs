import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

import { encryptSecret } from "../../src/lib/auth/crypto.ts";
import { uaHashOf } from "../../src/lib/auth/ua.ts";

/**
 * セッションの即時失効 — issue #52 / #62
 *
 * 署名 cookie はステートレスなので、放っておくと「発行済みのセッションを殺す手段」が
 * 無い。端末を失くした子のセッションを親が切れること (#52) と、**本人がログアウトと
 * 言ったときにサーバ側でも死ぬ**こと (#62) を、HTTP 越しに固定する。
 *
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const MASTER_KEY = randomBytes(32);
const FAMILY = "family-passphrase-52";

const USER_TOKEN = "u_token0000000000000";
const USER_DEVICE = "u_device000000000000";
const USER_GUARDIAN = "u_guardian000000000";
/* ログアウト (#62) 用。端末 2 台ぶんの記録を持つ */
const USER_LOGOUT = "u_logout0000000000000";
/* 巻き添えが無いことを見るための赤の他人 */
const USER_BYSTANDER = "u_bystander0000000000";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const IPHONE_UPDATED =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let baseUrl;
let server;
let dataDir;

const now = new Date().toISOString();

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** 世代付きのセッション cookie (通常のログインで発行されるものと同じ形) */
function sessionCookie(uid, { tv = 0, ua, dv = 0, expiresIn = 3600 } = {}) {
  const iat = Math.floor(Date.now() / 1000) - 60;
  const payload = { uid, iat, exp: Math.floor(Date.now() / 1000) + expiresIn, tv, dv };
  if (ua) {
    payload.ua = uaHashOf(ua);
    payload.uc = ua.includes("iPhone") ? "iphone" : "other";
  }
  return signToken(payload);
}

function cookieFor(uid, ua, tv = 0, dv = 0) {
  return sessionCookie(uid, { tv, ua, dv });
}

async function freePort() {
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function get(pathname, { cookie, ua = IPHONE } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    headers: { ...(cookie ? { cookie: `efk_session=${cookie}` } : {}), "user-agent": ua },
  });
}

function post(pathname, body, { cookie, ua = IPHONE } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "user-agent": ua,
      ...(cookie ? { cookie: `efk_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** users.json を書き換える (外側から失効させた状況を作る) */
async function patchPool(mutate) {
  const file = path.join(dataDir, "users.json");
  const pool = JSON.parse(await readFile(file, "utf8"));
  mutate(pool);
  await writeFile(file, JSON.stringify(pool));
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "efk-revoke-test-"));
  await mkdir(path.join(dataDir, "content"), { recursive: true });

  const user = (id, displayName) => ({
    id,
    displayName,
    avatar: "fox",
    color: "#7dd3fc",
    credentials: [],
    createdAt: now,
    updatedAt: now,
  });

  await writeFile(
    path.join(dataDir, "users.json"),
    JSON.stringify({
      version: 1,
      updatedAt: now,
      familySecret: encryptSecret(JSON.stringify({ guardianPassphrase: FAMILY }), MASTER_KEY),
      users: [
        /* 全端末失効のテスト用 (tokenVersion だけ見る) */
        { ...user(USER_TOKEN, "Token"), tokenVersion: 0, devices: [] },
        /* 端末単位失効のテスト用 (2 台ぶんの記録) */
        {
          ...user(USER_DEVICE, "Device"),
          tokenVersion: 0,
          devices: [
            { ua: uaHashOf(IPHONE), uc: "iphone", version: 0, lastSeenAt: now },
            { ua: uaHashOf(IPHONE_UPDATED), uc: "iphone", version: 0, lastSeenAt: now },
          ],
        },
        /* 合言葉で切るテスト用 */
        { ...user(USER_GUARDIAN, "Guardian"), tokenVersion: 0, devices: [] },
        /* ログアウトで端末単位に切るテスト用 (2 台ぶんの記録) */
        {
          ...user(USER_LOGOUT, "Logout"),
          tokenVersion: 0,
          devices: [
            { ua: uaHashOf(IPHONE), uc: "iphone", version: 0, lastSeenAt: now },
            { ua: uaHashOf(IPHONE_UPDATED), uc: "iphone", version: 0, lastSeenAt: now },
          ],
        },
        /* 別人のセッションが巻き添えにならないことの確認用 */
        { ...user(USER_BYSTANDER, "Bystander"), tokenVersion: 0, devices: [] },
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
        USERPOOL_MASTER_KEY: MASTER_KEY.toString("base64"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/login`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("サーバが起動しませんでした");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
});

after(() => {
  server?.kill("SIGTERM");
});

describe("tokenVersion — 全端末の即時失効", () => {
  test("世代が一致するセッションは通る", async () => {
    const res = await get("/api/auth/me", { cookie: sessionCookie(USER_TOKEN) });
    assert.equal(res.status, 200);
  });

  test("tokenVersion が上がると、それ以前の cookie は即座に通らない", async () => {
    const cookie = sessionCookie(USER_TOKEN);
    await patchPool((pool) => {
      const u = pool.users.find((x) => x.id === USER_TOKEN);
      u.tokenVersion = 1;
    });
    try {
      const res = await get("/api/auth/me", { cookie });
      assert.equal(res.status, 401);
      /* HTML はログイン画面へ */
      const html = await get("/quiz", { cookie });
      assert.equal(html.status, 307);
      assert.match(html.headers.get("location") ?? "", /\/login$/);
    } finally {
      await patchPool((pool) => {
        pool.users.find((x) => x.id === USER_TOKEN).tokenVersion = 0;
      });
    }
  });

  test("世代を持たない古い cookie は通らない", async () => {
    const legacy = signToken({
      uid: USER_TOKEN,
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await get("/api/auth/me", { cookie: legacy });
    assert.equal(res.status, 401);
  });

  test("本人のセッションで失効すると、その cookie は通らなくなる", async () => {
    const cookie = sessionCookie(USER_TOKEN);
    const res = await post("/api/auth/revoke", { scope: "all" }, { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, "all");
    assert.equal(typeof body.tokenVersion, "number");

    const after = await get("/api/auth/me", { cookie });
    assert.equal(after.status, 401, "失効後の cookie が通ってしまう");
  });
});

describe("端末単位の失効", () => {
  test("1 台だけ切ると、もう 1 台は生きたまま", async () => {
    const phone = cookieFor(USER_DEVICE, IPHONE);
    const phoneUpdated = cookieFor(USER_DEVICE, IPHONE_UPDATED);

    assert.equal((await get("/api/auth/me", { cookie: phone })).status, 200);
    assert.equal((await get("/api/auth/me", { cookie: phoneUpdated, ua: IPHONE_UPDATED })).status, 200);

    /* 親が「この端末だけ」切る */
    const res = await post("/api/auth/revoke", {
      scope: "device",
      userId: USER_DEVICE,
      ua: uaHashOf(IPHONE),
      guardianPassphrase: FAMILY,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, "device");

    /* 切った端末は通らない / もう 1 台は通る */
    assert.equal((await get("/api/auth/me", { cookie: phone })).status, 401);
    assert.equal((await get("/api/auth/me", { cookie: phoneUpdated, ua: IPHONE_UPDATED })).status, 200);
  });

  test("端末の一覧は合言葉を確かめた後だけ返る", async () => {
    const denied = await post("/api/auth/devices", { userId: USER_DEVICE });
    assert.equal(denied.status, 403);

    const res = await post("/api/auth/devices", {
      userId: USER_DEVICE,
      guardianPassphrase: FAMILY,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.devices.length, 2);
    for (const device of body.devices) {
      assert.equal(device.ua.length, 16);
      assert.equal(device.uc, "iphone");
      assert.ok(device.lastSeenAt);
      /* 生の UA は返さない */
      assert.ok(!JSON.stringify(device).includes("Mozilla"));
    }
  });
});

describe("合言葉による失効 (端末を失くした子)", () => {
  test("合言葉が違えば 403", async () => {
    const res = await post("/api/auth/revoke", {
      scope: "all",
      userId: USER_GUARDIAN,
      guardianPassphrase: "wrong-passphrase",
    });
    assert.equal(res.status, 403);
  });

  test("合言葉で対象の子を全端末ログアウトさせる", async () => {
    const cookie = sessionCookie(USER_GUARDIAN);
    assert.equal((await get("/api/auth/me", { cookie })).status, 200);

    const res = await post("/api/auth/revoke", {
      scope: "all",
      userId: USER_GUARDIAN,
      guardianPassphrase: FAMILY,
    });
    assert.equal(res.status, 200);

    assert.equal((await get("/api/auth/me", { cookie })).status, 401);

    /* 端末の記憶 (efk_device) は消さない = 次のログイン候補は残る */
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.ok(!setCookie.includes("efk_device=;"), "efk_device を消してはいけない");
  });

  test("ログインしていない人の失効はできない", async () => {
    const res = await post("/api/auth/revoke", { scope: "all" });
    assert.equal(res.status, 401);
  });
});

/* ------------------------------------------------------------------ */
/* ログアウトもサーバ側の失効を通ること — issue #62                      */
/* ------------------------------------------------------------------ */

/** users.json の現在の世代を読む (cookie を「いま正しい世代」で組み立てるため) */
async function versionOf(uid, ua) {
  const pool = JSON.parse(await readFile(path.join(dataDir, "users.json"), "utf8"));
  const user = pool.users.find((x) => x.id === uid);
  assert.ok(user, `ユーザー ${uid} が見つかりません`);
  const device = (user.devices ?? []).find((d) => d.ua === uaHashOf(ua));
  return { tokenVersion: user.tokenVersion ?? 0, deviceVersion: device?.version ?? 0 };
}

describe("ログアウト — サーバ側でも失効させる (issue #62)", () => {
  test("ログアウトすると、その cookie はサーバ側でも通らなくなる", async () => {
    const { tokenVersion, deviceVersion } = await versionOf(USER_LOGOUT, IPHONE);
    const cookie = cookieFor(USER_LOGOUT, IPHONE, tokenVersion, deviceVersion);
    assert.equal((await get("/api/auth/me", { cookie })).status, 200);

    const res = await post("/api/auth/logout", {}, { cookie });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).loggedOut, true);

    /* ブラウザから消しただけでなく、同じ cookie を投げ直しても通らない */
    assert.equal((await get("/api/auth/me", { cookie })).status, 401);
    const html = await get("/quiz", { cookie });
    assert.equal(html.status, 307);
    assert.match(html.headers.get("location") ?? "", /\/login$/);

    /* 端末の記憶 (efk_device) は消さない (次のログイン候補は残す) */
    assert.ok(!(res.headers.get("set-cookie") ?? "").includes("efk_device=;"));
  });

  test("同じ端末の別タブも一緒に切れる", async () => {
    const { tokenVersion, deviceVersion } = await versionOf(USER_LOGOUT, IPHONE);
    const tab1 = cookieFor(USER_LOGOUT, IPHONE, tokenVersion, deviceVersion);
    const tab2 = cookieFor(USER_LOGOUT, IPHONE, tokenVersion, deviceVersion);

    assert.equal((await post("/api/auth/logout", {}, { cookie: tab1 })).status, 200);
    assert.equal((await get("/api/auth/me", { cookie: tab2 })).status, 401);
  });

  test("他の端末と兄弟のセッションは巻き添えにならない", async () => {
    const other = await versionOf(USER_LOGOUT, IPHONE_UPDATED);
    const otherDevice = cookieFor(USER_LOGOUT, IPHONE_UPDATED, other.tokenVersion, other.deviceVersion);
    const bystanderTv = (await versionOf(USER_BYSTANDER, IPHONE)).tokenVersion;
    const bystander = sessionCookie(USER_BYSTANDER, { tv: bystanderTv });

    const mine = await versionOf(USER_LOGOUT, IPHONE);
    const cookie = cookieFor(USER_LOGOUT, IPHONE, mine.tokenVersion, mine.deviceVersion);
    assert.equal((await post("/api/auth/logout", {}, { cookie })).status, 200);

    assert.equal(
      (await get("/api/auth/me", { cookie: otherDevice, ua: IPHONE_UPDATED })).status,
      200,
      "同じ子の別端末まで切ってはいけない",
    );
    assert.equal(
      (await get("/api/auth/me", { cookie: bystander })).status,
      200,
      "他人のセッションを切ってはいけない",
    );
  });

  test("ログアウト後に再ログインしたセッションは通る (世代が上がっても壊れない)", async () => {
    const { tokenVersion, deviceVersion } = await versionOf(USER_LOGOUT, IPHONE);
    const fresh = cookieFor(USER_LOGOUT, IPHONE, tokenVersion, deviceVersion);
    assert.equal((await get("/api/auth/me", { cookie: fresh })).status, 200);
  });

  test("セッションが無くてもログアウトは成功する (cookie の掃除)", async () => {
    const res = await post("/api/auth/logout", {});
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie") ?? "", /efk_session=;/);
  });
});
