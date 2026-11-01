#!/usr/bin/env node
/**
 * おうちの合言葉 (保護者パスフレーズ) を 決め直す — 忘れたときの復旧用。
 *
 *   npm run auth:passphrase -- "あたらしい-あいことば"
 *
 * 合言葉は 1 つだけ。こどもの追加も 端末の追加も これで通る。
 * サーバーに触れる人 (= おうちの ひと) だけが実行できる前提のスクリプト。
 *
 * 本番 (systemd) では `~/.config/english-for-kids/auth.env` から
 * AUTH_DATA_DIR / USERPOOL_MASTER_KEY を読む。
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { encryptSecret } from "../src/lib/auth/crypto.ts";

const ENV_FILE = path.join(homedir(), ".config", "english-for-kids", "auth.env");

/** 本番の EnvironmentFile を読む (既に環境変数がある場合は触らない) */
async function loadEnvFile() {
  let raw;
  try {
    raw = await readFile(ENV_FILE, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

/** 保存形式は src/lib/auth/pool.ts の setFamilyPassphrase と揃える */
async function setFamilyPassphrase(passphrase) {
  const normalized = passphrase.normalize("NFKC").trim();
  if (normalized.length < 8) {
    throw new Error("合言葉は 8 もじ いじょうに してください");
  }
  const masterKey = Buffer.from(process.env.USERPOOL_MASTER_KEY ?? "", "base64");
  if (masterKey.length !== 32) {
    throw new Error("USERPOOL_MASTER_KEY (base64 / 32 バイト) が ありません");
  }

  const dataDir = process.env.AUTH_DATA_DIR
    ? path.resolve(process.env.AUTH_DATA_DIR)
    : path.join(process.cwd(), "data");
  const file = path.join(dataDir, "users.json");

  let pool;
  try {
    pool = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    pool = { version: 1, updatedAt: "", users: [] };
  }
  if (!Array.isArray(pool.users)) throw new Error(`${file} の形式が想定とちがいます`);

  pool.familySecret = encryptSecret(
    JSON.stringify({ guardianPassphrase: normalized }),
    masterKey,
  );
  pool.updatedAt = new Date().toISOString();

  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(pool, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  await chmod(file, 0o600);
  return file;
}

await loadEnvFile();

const next = process.argv.slice(2).join(" ").trim();
if (next === "") {
  console.error('つかいかた: npm run auth:passphrase -- "あたらしい-あいことば"');
  process.exit(1);
}

const file = await setFamilyPassphrase(next);
console.log("おうちの 合言葉を 更新しました。");
console.log(`保存先: ${file}`);
console.log("わすれないように メモして、こどもの端末で「この たんまつを とうろく」を やりなおしてください。");
