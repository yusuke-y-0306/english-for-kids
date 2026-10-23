#!/usr/bin/env node
/**
 * 認証用の鍵を生成する。
 *
 * 使い方:
 *   npm run auth:keygen
 *
 * 出力された 2 行を .env.local (開発) または systemd の EnvironmentFile (本番) に貼る。
 *   USERPOOL_MASTER_KEY    : ユーザーの「秘密」を暗号化する鍵 (base64 / 32 バイト)
 *   SESSION_SECRET         : セッション cookie の署名鍵 (64 文字)
 *
 * 注意: マスター鍵を変えると、保存済みの保護者パスフレーズは復号できなくなる。
 */

import { randomBytes } from "node:crypto";

const masterKey = randomBytes(32).toString("base64");
const sessionSecret = randomBytes(48).toString("hex");

console.log("USERPOOL_MASTER_KEY=" + masterKey);
console.log("SESSION_SECRET=" + sessionSecret);
