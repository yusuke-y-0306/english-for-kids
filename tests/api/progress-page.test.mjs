import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

/**
 * 進捗ページ — issue #68
 *
 * 固定したい主張:
 *  1. 未ログインなら `/progress` は `/login` へ 307 (default-deny のまま)
 *  2. 学習のある子には、ストリーク・きょうの数字・SVG のグラフ・カテゴリ・単語が出る
 *  3. 学習ゼロの子には **空状態**（エラー画面にしない）
 *  4. グラフは **自前の SVG**（外部ライブラリの script/img を読み込まない）
 *  5. 数字は API (#67) と同じ (SSR で直接集計している)
 *
 * 実行: npm run build && npm run test:api
 */

const SESSION_SECRET = randomBytes(32).toString("hex");
const USER_A = "u_alpha000000000000";
const USER_EMPTY = "u_empty000000000000";

const PAGE = "/progress";

let baseUrl;
let server;
let dataDir;
let contentDir;

function todayKey(offsetDays = 0) {
  const when = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
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

/**
 * React は隣り合うテキストノードの間に `<!-- -->` を挟む。
 * 日本語の文言を素直に照合したいので、取得した HTML から取り除いてから検査する。
 */
function stripRscMarkers(html) {
  return html.replaceAll("<!-- -->", "");
}

async function fetchPage({ cookie, redirect = "manual" } = {}) {
  return fetch(`${baseUrl}${PAGE}`, {
    redirect,
    headers: {
      accept: "text/html",
      ...(cookie ? { cookie: `efk_session=${cookie}` } : {}),
    },
  });
}

/** ログイン済みで本文を取る (RSC のマーカーを落としたもの) */
async function pageHtml(cookie) {
  const res = await fetchPage({ cookie });
  assert.equal(res.status, 200);
  return stripRscMarkers(await res.text());
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
      users: [USER_A, USER_EMPTY].map((id) => ({
        id,
        displayName: id === USER_A ? "Alpha" : "Empty",
        avatar: "fox",
        color: "#7dd3fc",
        credentials: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    }),
  );

  const today = todayKey();
  const yesterday = todayKey(-1);

  /* 学習のある子: 2 日連続、クイズ 2 ラウンド + 発音 3 回 */
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
          longestStreak: 2,
          lastStudyAt: "2026-11-09T00:00:00.000Z",
          updatedAt: "2026-11-09T00:00:00.000Z",
        },
        pronunciation: {
          version: 1,
          totalAttempts: 3,
          lastAttemptAt: "2026-11-09T00:00:00.000Z",
          byWord: {
            "food/apple": { score: "ok", attempts: 2, updatedAt: "2026-11-09T00:00:00.000Z" },
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

describe("未ログイン", () => {
  test("307 で /login へ送る (default-deny)", async () => {
    const res = await fetchPage();
    assert.equal(res.status, 307);
    const location = res.headers.get("location") ?? "";
    assert.ok(location.endsWith("/login"), `location: ${location}`);
    /* 認可の結果をキャッシュさせない */
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("HTML 系の応答には CSP が付く", async () => {
    const res = await fetchPage();
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("default-src 'self'"), csp);
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), "unsafe-inline は入れない");
  });
});

describe("学習のある子", () => {
  test("200 で、ストリーク・きょうの数字が出る", async () => {
    const html = await pageHtml(sessionCookie(USER_A));

    assert.match(html, /がんばりの きろく/);
    /* 2 日連続 (昨日 + 今日) */
    assert.match(html, /2 日 れんぞく/);
    assert.match(html, /きょうも できたね/);
    /* きょうの数字: クイズ 1 ラウンド・正答率 67%・発音 3 回 */
    assert.match(html, /67/);
    assert.match(html, /きょうは クイズ 2 \/ 3 もん せいかい/);
  });

  test("グラフは自前の SVG で、外部ライブラリを読み込まない", async () => {
    const html = await pageHtml(sessionCookie(USER_A));

    assert.match(html, /さいきん 7 日/);
    assert.match(html, /<svg[^>]*viewBox="0 0 340 196"/, "SVG のグラフがある");
    assert.match(html, /role="img"/, "グラフに代替テキスト (role=img) がある");
    /* 外部オリジンの script / img を足していない */
    const externals = [...html.matchAll(/<(?:script|img)[^>]+src="(https?:\/\/[^"]+)"/g)];
    assert.deepEqual(externals, []);
    /* チャート用ライブラリの痕跡が無い */
    assert.doesNotMatch(html, /chart\.js|recharts|d3\./i);
  });

  test("カテゴリ別と単語別が出る (折りたたみは details)", async () => {
    const html = await pageHtml(sessionCookie(USER_A));

    assert.match(html, /カテゴリ別 できた かず/);
    assert.match(html, /動物/);
    assert.match(html, /1 \/ 8 ご/, "どうぶつは 8 語中 1 語おぼえた");
    /* 単語の ようす は JS 無しの折りたたみ */
    assert.match(html, /<details/);
    assert.match(html, /ことばの ようす/);
    /* おぼえた = dog (クイズ 3 回正解) */
    assert.match(html, /dog/);
    assert.match(html, /いぬ/);
  });

  test("API と同じ数字になる (SSR で同じ関数を通している)", async () => {
    const html = await pageHtml(sessionCookie(USER_A));
    const api = await (
      await fetch(`${baseUrl}/api/progress?days=7`, {
        headers: { cookie: `efk_session=${sessionCookie(USER_A)}` },
      })
    ).json();

    const today = api.days[api.days.length - 1];
    assert.match(html, new RegExp(`${today.quiz.correct} / ${today.quiz.total} もん せいかい`));
    assert.equal(api.streak.current, 2);
  });
});

describe("学習ゼロの子 (空状態)", () => {
  test("200 で、責めない文言と あそびへの導線が出る", async () => {
    const res = await fetchPage({ cookie: sessionCookie(USER_EMPTY) });
    assert.equal(res.status, 200, "エラー画面にしない");
    const html = stripRscMarkers(await res.text());

    assert.match(html, /まだ きろくが ないよ/);
    assert.match(html, /ひとつ やってみよう/);
    /* クイズ / カードへの導線 */
    assert.match(html, /href="\/quiz"/);
    assert.match(html, /href="\/flashcards"/);
    /* グラフやカテゴリは出さない (0 の棒だけの画面にしない) */
    assert.doesNotMatch(html, /さいきん 7 日/);
    assert.doesNotMatch(html, /カテゴリ別 できた かず/);
  });
});

describe("ホームからの導線", () => {
  test("ホームの進捗カードに href=\"/progress\" がある", async () => {
    const html = await pageHtml(sessionCookie(USER_A));
    const home = await (
      await fetch(`${baseUrl}/`, {
        headers: { accept: "text/html", cookie: `efk_session=${sessionCookie(USER_A)}` },
      })
    ).text();
    assert.equal(html.length > 0, true);
    assert.match(home, /href="\/progress"/);
    assert.match(home, /進捗管理/);
  });
});
