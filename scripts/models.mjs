#!/usr/bin/env node
/**
 * 音声モデル (Moonshine) の取得・検証・公開 CLI — issue #30
 *
 *   node scripts/models.mjs fetch            上流 (Moonshine カタログ) から models-cache/ へ取得
 *   node scripts/models.mjs manifest --init  取得済みファイルから sha256 を確定し model-manifest.ts を生成
 *   node scripts/models.mjs verify           models-cache/ が manifest と一致するか検証
 *   node scripts/models.mjs publish          verify の後、gh-pages ブランチへ公開 (強制 push)
 *   node scripts/models.mjs serve            開発用の静的配信 (127.0.0.1:3101)
 *   node scripts/models.mjs check [--remote] manifest の整合性 (任意で公開 URL の到達性) を検査
 *
 * 設計の要点:
 *  - モデルの配信元は「アプリとは別オリジン」(案 A)。理由と運用手順は docs/speech-model-hosting.md。
 *  - 信頼の起点は manifest に固定した sha256。ホスト (GitHub Pages) は信頼しない。
 *  - `manifest --init` はハッシュを新規に確定する操作なので、人が差分をレビューしてから実行する。
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_JSON = path.join(ROOT, "scripts/models/source.json");
const MANIFEST_TS = path.join(ROOT, "src/lib/speech/model-manifest.ts");
const CACHE_DIR = path.join(ROOT, "models-cache");

const DEV_PORT = 3101;
const GIT_USER = { name: "steve-lobs-bot", email: "steve-lobs-bot@users.noreply.github.com" };

/* ------------------------------------------------------------------ */
/* 共通                                                                */
/* ------------------------------------------------------------------ */

async function readSource() {
  return JSON.parse(await readFile(SOURCE_JSON, "utf8"));
}

/** manifest を TS として評価せず、正規表現で読む (Node から .ts を import しない) */
async function readManifest() {
  let text;
  try {
    text = await readFile(MANIFEST_TS, "utf8");
  } catch {
    return null;
  }
  const pick = (key) => {
    const m = text.match(new RegExp(`export const ${key} = ("(?:[^"\\\\]|\\\\.)*"|\\d+);`));
    if (!m) throw new Error(`model-manifest.ts に ${key} が見つかりません`);
    return JSON.parse(m[1]);
  };
  const files = {};
  const re = /  "([^"]+)": \{ bytes: (\d+), sha256: "([0-9a-f]{64})" \},/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    files[m[1]] = { bytes: Number(m[2]), sha256: m[3] };
  }
  return {
    modelName: pick("MODEL_NAME"),
    variant: pick("MODEL_VARIANT"),
    pathPrefix: pick("MODEL_PATH_PREFIX"),
    setHash: pick("MODEL_SET_HASH"),
    totalBytes: pick("MODEL_TOTAL_BYTES"),
    files,
  };
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

/** 上流の版 (variant) ごとのディレクトリ */
function cacheDirFor(source) {
  return path.join(CACHE_DIR, source.model, source.variant);
}

/* ------------------------------------------------------------------ */
/* fetch                                                               */
/* ------------------------------------------------------------------ */

async function cmdFetch() {
  const source = await readSource();
  const dir = cacheDirFor(source);
  await mkdir(dir, { recursive: true });

  for (const file of source.files) {
    const dest = path.join(dir, file.name);
    const existing = await stat(dest).catch(() => null);
    if (existing && existing.size === file.bytes) {
      console.log(`skip  ${file.name} (${file.bytes} bytes, 取得済み)`);
      continue;
    }
    process.stdout.write(`get   ${file.name} ... `);
    const res = await fetch(file.sourceUrl);
    if (!res.ok) throw new Error(`${file.name}: HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength !== file.bytes) {
      throw new Error(`${file.name}: サイズ不一致 (期待 ${file.bytes} / 実際 ${buf.byteLength})`);
    }
    await writeFile(dest, buf);
    console.log(`${buf.byteLength} bytes`);
  }

  const manifest = await readManifest();
  if (manifest) {
    await cmdVerify();
  } else {
    console.log("\nmodel-manifest.ts がまだありません。次の手順:");
    console.log("  node scripts/models.mjs manifest --init   # sha256 を確定 (差分をレビューすること)");
  }
}

/* ------------------------------------------------------------------ */
/* manifest                                                            */
/* ------------------------------------------------------------------ */

async function cmdManifest(argv) {
  const init = argv.includes("--init");
  const source = await readSource();
  const dir = cacheDirFor(source);

  const entries = [];
  for (const file of source.files) {
    const file_path = path.join(dir, file.name);
    const st = await stat(file_path).catch(() => null);
    if (!st) {
      throw new Error(`${file_path} がありません。先に \`node scripts/models.mjs fetch\` を実行してください`);
    }
    if (st.size !== file.bytes) {
      throw new Error(`${file.name}: サイズ不一致 (期待 ${file.bytes} / 実際 ${st.size})`);
    }
    entries.push({ name: file.name, bytes: st.size, sha256: await sha256File(file_path) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // セット全体の指紋。パスの一部にして、内容が変われば URL も変わるようにする。
  const setHash = createHash("sha256")
    .update(entries.map((e) => `${e.name}:${e.sha256}`).join("\n"))
    .digest("hex");
  const pathPrefix = `models/${source.model}/${source.variant}-${setHash.slice(0, 8)}`;
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);

  const existing = await readManifest();
  if (!init && existing && existing.setHash !== setHash) {
    console.error("manifest と models-cache/ が一致しません。");
    console.error(`  manifest: ${existing.setHash}`);
    console.error(`  実際    : ${setHash}`);
    console.error("意図した更新なら `--init` を付けて再実行し、差分 (sha256) をレビューしてください。");
    process.exit(1);
  }

  const rows = entries
    .map((e) => `  "${e.name}": { bytes: ${e.bytes}, sha256: "${e.sha256}" },`)
    .join("\n");

  const ts = `/**
 * Moonshine モデルのファイル一覧と sha256 — 自動生成 (scripts/models.mjs manifest --init)
 * 手で編集しないこと。更新は docs/speech-model-hosting.md の手順で行う。
 *
 * ここに固定された sha256 が「信頼の起点」。配信元 (別オリジン) は信頼しない前提で、
 * 読み込み前に必ず照合すること (issue #29)。
 */

/** 上流のモデル名 */
export const MODEL_NAME = ${JSON.stringify(source.model)};
/** 上流の量子化バリアント */
export const MODEL_VARIANT = ${JSON.stringify(source.variant)};
/** ファイル集合の指紋 (sha256 の総和) */
export const MODEL_SET_HASH = ${JSON.stringify(setHash)};
/** 配信先のパス接頭辞 (バージョン + 指紋の先頭 8 文字) */
export const MODEL_PATH_PREFIX = ${JSON.stringify(pathPrefix)};
/** 合計バイト数 */
export const MODEL_TOTAL_BYTES = ${totalBytes};

export const MODEL_FILES = {
${rows}
} as const;

export type ModelFileName = keyof typeof MODEL_FILES;
`;

  await writeFile(MANIFEST_TS, ts);
  console.log(`wrote ${path.relative(ROOT, MANIFEST_TS)}`);
  console.log(`  prefix      : ${pathPrefix}`);
  console.log(`  set hash    : ${setHash}`);
  console.log(`  total bytes : ${totalBytes}`);
}

/* ------------------------------------------------------------------ */
/* verify                                                              */
/* ------------------------------------------------------------------ */

async function cmdVerify() {
  const manifest = await readManifest();
  if (!manifest) throw new Error("model-manifest.ts がありません。`manifest --init` を先に実行してください");
  const source = await readSource();
  const dir = cacheDirFor(source);

  let ok = 0;
  const problems = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (!st) {
      problems.push(`${name}: ファイルがありません`);
      continue;
    }
    if (st.size !== expected.bytes) {
      problems.push(`${name}: サイズ不一致 (期待 ${expected.bytes} / 実際 ${st.size})`);
      continue;
    }
    const actual = await sha256File(file);
    if (actual !== expected.sha256) {
      problems.push(`${name}: sha256 不一致 (期待 ${expected.sha256.slice(0, 12)}… / 実際 ${actual.slice(0, 12)}…)`);
      continue;
    }
    ok += 1;
  }

  // manifest に載っていないファイルが混ざっていないか (取り違え・残留物の検出)
  const present = (await readdir(dir).catch(() => [])).sort();
  const known = Object.keys(manifest.files).sort();
  const extra = present.filter((n) => !known.includes(n));
  if (extra.length > 0) problems.push(`manifest に無いファイル: ${extra.join(", ")}`);

  if (problems.length > 0) {
    console.error("NG: モデルの検証に失敗しました");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`OK: ${ok} ファイルすべて sha256 一致 (${manifest.totalBytes} bytes)`);
}

/* ------------------------------------------------------------------ */
/* publish (gh-pages)                                                  */
/* ------------------------------------------------------------------ */

async function gitRemote() {
  const { execFileSync } = await import("node:child_process");
  const url = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  return url;
}

async function gitCredentialHelper() {
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("git", ["-C", ROOT, "config", "--get", "credential.helper"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function cmdPublish() {
  const manifest = await readManifest();
  if (!manifest) throw new Error("model-manifest.ts がありません");
  await cmdVerify();

  const source = await readSource();
  const dir = cacheDirFor(source);
  const work = path.join(ROOT, ".tmp-gh-pages");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  const target = path.join(work, manifest.pathPrefix);
  await mkdir(target, { recursive: true });
  for (const name of Object.keys(manifest.files)) {
    await copyFile(path.join(dir, name), path.join(target, name));
  }
  // GitHub Pages の Jekyll 処理を無効化する (. で始まるパスを落とさない)
  await writeFile(path.join(work, ".nojekyll"), "");

  const { execFileSync } = await import("node:child_process");
  const credentialHelper = await gitCredentialHelper();
  const git = (args, extra = []) =>
    execFileSync("git", ["-C", work, ...extra, ...args], { stdio: "inherit" });

  git(["init", "-q"]);
  git(["checkout", "-q", "-b", "gh-pages"]);
  git(["add", "-A"]);
  git(
    ["commit", "-q", "-m", `models: ${manifest.pathPrefix} (${manifest.totalBytes} bytes)`],
    [
      "-c", `user.name=${GIT_USER.name}`,
      "-c", `user.email=${GIT_USER.email}`,
      "-c", "commit.gpgsign=false",
    ],
  );

  const remote = await gitRemote();
  const pushConfig = [
    "-c", "http.postBuffer=52428800",
    ...(credentialHelper ? ["-c", `credential.helper=${credentialHelper}`] : []),
  ];
  git(["push", "-q", "-f", remote, "gh-pages"], pushConfig);

  await rm(work, { recursive: true, force: true });
  console.log(`published: ${manifest.pathPrefix} -> gh-pages`);
  console.log("GitHub Pages の公開設定 (Settings > Pages > Deploy from a branch: gh-pages / root) が必要です。");
}

/* ------------------------------------------------------------------ */
/* serve (開発用)                                                      */
/* ------------------------------------------------------------------ */

async function cmdServe() {
  const manifest = await readManifest();
  if (!manifest) throw new Error("model-manifest.ts がありません");
  const source = await readSource();
  const dir = cacheDirFor(source);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const allowed = Object.prototype.hasOwnProperty.call(manifest.files, name);
    if ((req.method !== "GET" && req.method !== "HEAD") || !allowed) {
      res.writeHead(name && !allowed ? 404 : 405).end();
      return;
    }
    try {
      const body = await readFile(path.join(dir, name));
      res.writeHead(200, {
        "content-type": name.endsWith(".json") ? "application/json" : "application/octet-stream",
        "content-length": String(body.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.listen(DEV_PORT, "127.0.0.1", () => {
    console.log(`model origin (dev): http://127.0.0.1:${DEV_PORT}/${manifest.pathPrefix}/`);
    console.log("NODE_ENV=development のとき、アプリはこのオリジンからモデルを取得します。");
  });
}

/* ------------------------------------------------------------------ */
/* check                                                               */
/* ------------------------------------------------------------------ */

async function cmdCheck(argv) {
  const remote = argv.includes("--remote");
  const manifest = await readManifest();
  if (!manifest) throw new Error("model-manifest.ts がありません");
  const source = await readSource();

  const problems = [];
  const files = Object.entries(manifest.files);

  if (files.length !== source.files.length) {
    problems.push(`ファイル数が source.json と一致しません (${files.length} != ${source.files.length})`);
  }
  for (const file of source.files) {
    const entry = manifest.files[file.name];
    if (!entry) problems.push(`${file.name}: manifest にありません`);
    else if (entry.bytes !== file.bytes) problems.push(`${file.name}: source.json とサイズが違います`);
  }
  const sum = files.reduce((a, [, e]) => a + e.bytes, 0);
  if (sum !== manifest.totalBytes) problems.push(`totalBytes が合計と一致しません (${sum} != ${manifest.totalBytes})`);

  const expectedHash = createHash("sha256")
    .update(files.map(([n, e]) => `${n}:${e.sha256}`).sort().join("\n"))
    .digest("hex");
  if (expectedHash !== manifest.setHash) problems.push("MODEL_SET_HASH がファイル一覧と一致しません");
  if (!manifest.pathPrefix.endsWith(manifest.setHash.slice(0, 8))) {
    problems.push("MODEL_PATH_PREFIX に指紋 (先頭 8 文字) が含まれていません");
  }
  if (!manifest.pathPrefix.startsWith(`models/${manifest.modelName}/${manifest.variant}-`)) {
    problems.push("MODEL_PATH_PREFIX の形式が想定と違います");
  }

  if (problems.length > 0) {
    console.error("NG: manifest の整合性チェックに失敗しました");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`OK: manifest は整合しています (${files.length} ファイル / ${manifest.totalBytes} bytes)`);
  console.log(`  prefix: ${manifest.pathPrefix}`);

  if (!remote) return;
  console.log("\n公開 URL の到達性を確認します (ネットワーク):");
  const origin = process.env.MODEL_ORIGIN_OVERRIDE ?? "https://yusuke-y-0306.github.io/english-for-kids";
  let failed = 0;
  for (const [name, entry] of Object.entries(manifest.files)) {
    const url = `${origin}/${manifest.pathPrefix}/${name}`;
    try {
      // GitHub Pages は Accept-Encoding を見て圧縮版を返し、そのとき content-length は
      // 圧縮後のサイズになる。manifest は非圧縮のバイト数を載せているので、
      // identity を明示して「実際に展開されるサイズ」で比較する。
      const res = await fetch(url, { method: "HEAD", headers: { "accept-encoding": "identity" } });
      const len = Number(res.headers.get("content-length"));
      const okLen = !len || len === entry.bytes;
      console.log(`  ${res.ok && okLen ? "OK " : "NG "} ${name} (${res.status}${len ? `, ${len} bytes` : ""})`);
      if (!res.ok || !okLen) failed += 1;
    } catch (error) {
      console.log(`  NG  ${name}: ${error.message}`);
      failed += 1;
    }
  }

  // 一番小さいファイルだけ実際にダウンロードしてハッシュまで確かめる
  // (サイズだけ合っていても中身が違う可能性を潰す。全ファイルの照合はブラウザ側の #29 が行う)
  const [smokeName, smokeEntry] = Object.entries(manifest.files).sort((a, b) => a[1].bytes - b[1].bytes)[0];
  try {
    const res = await fetch(`${origin}/${manifest.pathPrefix}/${smokeName}`, {
      headers: { "accept-encoding": "identity" },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = createHash("sha256").update(buf).digest("hex");
    const ok = actual === smokeEntry.sha256;
    console.log(`  ${ok ? "OK " : "NG "} ${smokeName} の sha256 照合 (${buf.byteLength} bytes)`);
    if (!ok) failed += 1;
  } catch (error) {
    console.log(`  NG  ${smokeName} の sha256 照合: ${error.message}`);
    failed += 1;
  }
  if (failed > 0) process.exit(1);
}

/* ------------------------------------------------------------------ */

const [command, ...rest] = process.argv.slice(2);
const commands = {
  fetch: cmdFetch,
  manifest: () => cmdManifest(rest),
  verify: cmdVerify,
  publish: cmdPublish,
  serve: cmdServe,
  check: () => cmdCheck(rest),
};

if (!command || !commands[command]) {
  console.error("usage: node scripts/models.mjs <fetch|manifest --init|verify|publish|serve|check [--remote]>");
  process.exit(2);
}

await commands[command]();
