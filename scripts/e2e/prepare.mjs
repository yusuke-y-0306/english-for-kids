#!/usr/bin/env node
/**
 * E2E のフィクスチャを用意する (Playwright の前段)。
 *
 * やること:
 *  1. `.e2e/data` を毎回作り直し、`users.json` に「テスト用の子」を1人置く
 *     (データ置き場を分けるので、開発中の `data/` を汚さない)
 *  2. その子のセッション cookie を署名して `.e2e/state.json` に保存する
 *     (Playwright の storageState として読み込む)
 *
 * パスキー (WebAuthn) はブラウザの認証器が要るため E2E では扱わない。
 * 代わりに **署名済み cookie を直接置く**。門番 (proxy) の判定は本物の
 * セッションと同じ経路を通るので、認可の検証としては十分。
 *
 * 実行: node scripts/e2e/prepare.mjs
 */

import { createHmac } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  SESSION_COOKIE,
  SESSION_SECRET,
  STATE_FILE,
  USER_ID,
  USER_NAME,
} from "./constants.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = path.join(root, DATA_DIR);
const stateFile = path.join(root, STATE_FILE);

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);

await rm(dataDir, { recursive: true, force: true });
await mkdir(path.join(dataDir, "content"), { recursive: true });

const iso = new Date().toISOString();
await writeFile(
  path.join(dataDir, "users.json"),
  JSON.stringify(
    {
      version: 1,
      updatedAt: iso,
      users: [
        {
          id: USER_ID,
          displayName: USER_NAME,
          avatar: "fox",
          color: "#7dd3fc",
          tokenVersion: 0,
          /* 空 = 旧形式 cookie (端末指紋なし) として扱われる */
          devices: [],
          credentials: [],
          createdAt: iso,
          updatedAt: iso,
        },
      ],
    },
    null,
    2,
  ),
);

/* tv / dv は世代。users.json 側も 0 にしてあるので、この cookie は有効 */
const token = signToken({ uid: USER_ID, iat: now - 60, exp: now + 3600, tv: 0, dv: 0 });

await mkdir(path.dirname(stateFile), { recursive: true });
await writeFile(
  stateFile,
  JSON.stringify(
    {
      cookies: [
        {
          name: SESSION_COOKIE,
          value: token,
          domain: "127.0.0.1",
          path: "/",
          expires: now + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
    null,
    2,
  ),
);

console.log(`e2e fixtures: ${DATA_DIR} / ${STATE_FILE} (user ${USER_ID})`);
