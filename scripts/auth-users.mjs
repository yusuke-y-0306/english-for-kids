#!/usr/bin/env node
/**
 * ユーザープールの中身を確認する (読み取り専用)。
 *
 *   npm run auth:users
 *
 * 秘密・公開鍵そのものは表示しない (存在と件数だけ)。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.AUTH_DATA_DIR
  ? path.resolve(process.env.AUTH_DATA_DIR)
  : path.resolve(process.cwd(), "data");
const file = path.join(dataDir, "users.json");

try {
  const raw = await readFile(file, "utf8");
  const pool = JSON.parse(raw);
  const users = Array.isArray(pool.users) ? pool.users : [];
  console.log(`ユーザープール: ${file}`);
  console.log(`最終更新: ${pool.updatedAt ?? "-"}`);
  console.log(`ユーザー数: ${users.length}\n`);
  for (const user of users) {
    const credentials = Array.isArray(user.credentials) ? user.credentials : [];
    console.log(
      [
        `- ${user.avatar ?? "?"} ${user.displayName}`,
        `id=${user.id}`,
        `端末=${credentials.length}`,
        `秘密=${user.secret ? "暗号化済み" : "なし"}`,
        `作成=${user.createdAt ?? "-"}`,
      ].join("  "),
    );
  }
} catch (error) {
  if (error.code === "ENOENT") {
    console.log(`ユーザープールはまだ空です (${file})`);
    process.exit(0);
  }
  throw error;
}
