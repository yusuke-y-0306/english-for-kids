#!/usr/bin/env node
/**
 * セキュリティヘッダのスモークテスト (issue #33)
 *
 * 使い方:
 *   npm run build && npm run start -- -p 3100 &
 *   BASE_URL=http://127.0.0.1:3100 npm run headers:check
 *
 * 「ヘッダが付いている」だけでなく、**壊れやすい約束**を固定する:
 *  - script-src に 'unsafe-inline' が戻ってきたら失敗 (nonce 方式が崩れた合図)
 *  - script-src に 'wasm-unsafe-eval' が無くなったら失敗 (WASM が無言で死ぬ)
 *  - connect-src にモデル配信元以外の外部オリジンが増えたら失敗
 *  - inline script に nonce が付いていなければ失敗 (hydration が壊れる)
 *  - 同一オリジン以外の <script src> があれば失敗
 *
 * ブラウザでの確認 (CSP 違反 0 件 / crossOriginIsolated) は docs/security-headers.md の手順。
 */

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PATHS = (process.env.CHECK_PATHS ?? "/,/login,/flashcards,/build,/quiz").split(",");

/** モデル配信元 (issue #30)。connect-src の唯一の外部オリジン */
const EXPECTED_MODEL_ORIGIN = "https://yusuke-y-0306.github.io";
/**
 * モデルはこのパス配下にだけ置く (CSP の source 式はモデルのディレクトリまで絞る)。
 * CSP のパス一致は「末尾 / で前方一致」なので、source は必ず `/` で終わっていること。
 */
const EXPECTED_MODEL_PATH = "/english-for-kids/models/";

const failures = [];
const passes = [];

function check(ok, message) {
  (ok ? passes : failures).push(message);
}

function directivesOf(csp) {
  const map = new Map();
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    map.set(name.toLowerCase(), values);
  }
  return map;
}

function parseNonces(directiveValues) {
  return (directiveValues ?? [])
    .filter((v) => v.startsWith("'nonce-"))
    .map((v) => v.slice("'nonce-".length, -1));
}

function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const nonce = /\bnonce\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? null;
    out.push({ nonce, body: m[2] ?? "" });
  }
  return out;
}

function scriptSrcs(html) {
  const out = [];
  const re = /<script\b([^>]*)\bsrc\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[2]);
  return out;
}

async function main() {
  for (const path of PATHS) {
    const url = `${BASE}${path}`;
    const res = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/html" },
    });
    const label = `${path} (${res.status})`;

    // --- 固定ヘッダ ---
    const expected = {
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-resource-policy": "same-origin",
      "strict-transport-security": "max-age=63072000; includeSubDomains",
    };
    for (const [name, value] of Object.entries(expected)) {
      const actual = res.headers.get(name);
      check(actual === value, `${label} ${name}: ${actual ?? "(なし)"}`);
    }
    check(
      res.headers.get("x-powered-by") === null,
      `${label} x-powered-by が消えている`,
    );
    check(
      (res.headers.get("permissions-policy") ?? "").includes("microphone=(self)"),
      `${label} permissions-policy に microphone=(self)`,
    );

    // --- CSP ---
    const csp = res.headers.get("content-security-policy");
    check(csp !== null, `${label} content-security-policy がある`);
    check(
      res.headers.get("content-security-policy-report-only") === null,
      `${label} report-only になっていない (enforce)`,
    );
    if (!csp) continue;

    const d = directivesOf(csp);
    const scriptSrc = d.get("script-src") ?? [];
    check(scriptSrc.includes("'self'"), `${label} script-src 'self'`);
    check(!scriptSrc.includes("'unsafe-inline'"), `${label} script-src に 'unsafe-inline' が無い`);
    check(scriptSrc.includes("'wasm-unsafe-eval'"), `${label} script-src 'wasm-unsafe-eval' (WASM 用)`);
    check((d.get("default-src") ?? []).join(" ") === "'self'", `${label} default-src 'self'`);
    check((d.get("frame-ancestors") ?? []).includes("'none'"), `${label} frame-ancestors 'none'`);
    check((d.get("object-src") ?? []).includes("'none'"), `${label} object-src 'none'`);
    check((d.get("base-uri") ?? []).includes("'self'"), `${label} base-uri 'self'`);
    check((d.get("form-action") ?? []).includes("'self'"), `${label} form-action 'self'`);

    const connectSrc = d.get("connect-src") ?? [];
    const unexpected = connectSrc.filter((value) => {
      if (value === "'self'") return false;
      try {
        const u = new URL(value);
        return (
          u.origin !== EXPECTED_MODEL_ORIGIN ||
          !u.pathname.startsWith(EXPECTED_MODEL_PATH) ||
          !u.pathname.endsWith("/")
        );
      } catch {
        return true; // ホスト名だけの指定など、URL として解釈できない値も「想定外」
      }
    });
    check(
      unexpected.length === 0,
      `${label} connect-src は 'self' とモデル配信元だけ` +
        (unexpected.length ? ` (想定外: ${unexpected.join(" ")})` : ""),
    );
    check(
      connectSrc.some((v) => v.startsWith(EXPECTED_MODEL_ORIGIN + EXPECTED_MODEL_PATH)),
      `${label} connect-src にモデル配信元 ${EXPECTED_MODEL_ORIGIN}${EXPECTED_MODEL_PATH}*`,
    );

    const nonces = parseNonces(scriptSrc);
    check(nonces.length === 1, `${label} script-src の nonce は 1 つ`);

    // --- HTML の中身 (200 のときだけ) ---
    if (res.status !== 200) continue;
    const html = await res.text();

    const inline = inlineScripts(html);
    check(inline.length > 0, `${label} inline script がある (App Router の bootstrap)`);
    const nonce = nonces[0];
    const missing = inline.filter((s) => s.nonce !== nonce);
    check(
      missing.length === 0,
      `${label} inline script ${inline.length} 件すべてに nonce が付いている` +
        (missing.length ? ` (欠け ${missing.length} 件)` : ""),
    );

    const srcs = scriptSrcs(html);
    const external = srcs.filter((src) => {
      try {
        return new URL(src, BASE).origin !== new URL(BASE).origin;
      } catch {
        return true;
      }
    });
    check(
      external.length === 0,
      `${label} 外部オリジンの script が無い (${srcs.length} 件すべて同一オリジン)`,
    );
  }

  for (const line of passes) console.log(`  ok   ${line}`);
  if (failures.length) {
    console.error("\n失敗:");
    for (const line of failures) console.error(`  NG   ${line}`);
    console.error(`\n${failures.length} 件の失敗 (${BASE})`);
    process.exit(1);
  }
  console.log(`\n${passes.length} 件すべて ok (${BASE})`);
}

main().catch((error) => {
  console.error("ヘッダ確認に失敗しました:", error);
  process.exit(1);
});
