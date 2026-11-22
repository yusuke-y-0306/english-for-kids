#!/usr/bin/env node
/**
 * verify.mjs — ローカルで CI と同じ検証を 1 コマンドで回すハーネス。
 *
 * 目的:
 *  1. CI (`.github/workflows/ci.yml`) の検証項目を「実行可能な1つの入口」に写し、
 *     ローカル緑 / CI 赤 のズレを減らす。
 *  2. 失敗しても全ステップを走り切り、どこが赤かを一覧で返す (エージェントが
 *     1 回の実行で修正対象を把握できるようにする)。
 *  3. 実行結果を `.verify/latest.json` に残し、時間・失敗箇所を後から比較できる。
 *  4. ci.yml に増えたステップを検出して「verify 未追従」を警告する (ドリフト検出)。
 *
 * 使い方:
 *   npm run verify              # フル (build / セキュリティヘッダのスモークまで)
 *   npm run verify -- --no-build # 型・lint・コンテンツ検証・単体テストのみ (高速)
 *   npm run verify -- --json out.json
 *
 * 注意: API テスト (`tests/api`) は実サーバを起動して HTTP 越しに確かめるため、
 * **ビルド成果物 (.next) に依存する**。古い .next のまま回すと、コードは正しいのに
 * 期待値だけがずれる「偽の赤」が出る (2026-11-22 に実際に踏んだ)。
 * そのため --no-build では API テストを実行せず、単体テストだけを回す。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CI_YML = path.join(ROOT, ".github/workflows/ci.yml");
const REPORT_DIR = path.join(ROOT, ".verify");

const argv = process.argv.slice(2);
const noBuild = argv.includes("--no-build");
const jsonIdx = argv.indexOf("--json");
const jsonPath = jsonIdx >= 0 ? path.resolve(argv[jsonIdx + 1]) : null;
const HEADERS_PORT = 3100;

/* ブラウザ E2E 用の共有ライブラリ。root 無しで入れた場合の置き場 (docs/harness.md 参照)。
 * CI は `playwright install --with-deps` でシステム側に入るので、ここは無くてもよい。 */
const LOCAL_PW_LIBS = path.join(os.homedir(), ".local/lib/playwright-deps/usr/lib/x86_64-linux-gnu");
const EXTRA_ENV = existsSync(LOCAL_PW_LIBS)
  ? { LD_LIBRARY_PATH: [LOCAL_PW_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
  : {};

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", reset: "\x1b[0m" }
  : { dim: "", red: "", green: "", yellow: "", bold: "", reset: "" };

function runStep(cmd, args, { env = {}, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...EXTRA_ENV, ...env } });
    let out = "";
    const collect = (buf) => {
      const s = buf.toString();
      out += s;
      if (out.length > 400_000) out = out.slice(-400_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, ms: Date.now() - startedAt, out });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, ms: Date.now() - startedAt, out: String(err) });
    });
  });
}

/** build 済みサーバを起動し、/login が応答するまで待ってからフックを実行する */
async function withServer(port, fn) {
  const server = spawn("npm", ["run", "start", "--", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env, ...EXTRA_ENV },
  });
  let log = "";
  const collect = (b) => (log += b.toString());
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  try {
    const deadline = Date.now() + 45_000;
    for (;;) {
      if (server.exitCode !== null) {
        return { code: 1, out: `server exited early (code ${server.exitCode})\n${log}` };
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/login`);
        if (res.status < 500) break;
      } catch {
        /* まだ起動していない */
      }
      if (Date.now() > deadline) {
        return { code: 1, out: `server did not become ready within 45s\n${log}` };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn();
  } finally {
    server.kill("SIGTERM");
    setTimeout(() => server.kill("SIGKILL"), 3000).unref();
  }
}

/** ci.yml の step 名を拾う (依存なしの行ベース解析。この形のファイルにだけ使う) */
function ciStepNames() {
  if (!existsSync(CI_YML)) return [];
  const text = readFileSync(CI_YML, "utf8");
  return [...text.matchAll(/^\s*-\s+name:\s*(.+)$/gm)].map((m) => m[1].trim());
}

const steps = [
  { ciName: "Generate route types", label: "typegen", cmd: "npx", args: ["next", "typegen"] },
  { ciName: "Type check", label: "typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
  { ciName: "Lint", label: "lint", cmd: "npm", args: ["run", "lint"] },
  { ciName: "Check model manifest", label: "models", cmd: "npm", args: ["run", "models:check"] },
  { ciName: "Check vocabulary content", label: "vocabulary", cmd: "npm", args: ["run", "vocabulary:check"] },
  { ciName: "Check word audio assets", label: "audio", cmd: "npm", args: ["run", "audio:check"] },
  { ciName: "Build", label: "build", cmd: "npm", args: ["run", "build"], needsBuild: true },
  { ciName: "Check ASR engine assets", label: "asr-assets", cmd: "node", args: ["scripts/asr-engine.mjs", "--check"], needsBuild: true },
  {
    ciName: "Security headers smoke test",
    label: "headers",
    needsBuild: true,
    async run() {
      return withServer(HEADERS_PORT, async () => {
        const r = await runStep("npm", ["run", "headers:check"], {
          env: { BASE_URL: `http://127.0.0.1:${HEADERS_PORT}` },
          timeoutMs: 5 * 60 * 1000,
        });
        return { code: r.code, out: r.out };
      });
    },
  },
  // CI は `npm run test` (unit + api)。ただし API 側は build 依存なので分けて扱う。
  { ciName: "Unit / API tests", label: "test:unit", cmd: "npm", args: ["run", "test:unit"] },
  { ciName: "Unit / API tests", label: "test:api", cmd: "npm", args: ["run", "test:api"], needsBuild: true },
  { ciName: "E2E (Playwright)", label: "test:e2e", cmd: "npm", args: ["run", "test:e2e"], needsBuild: true, timeoutMs: 10 * 60 * 1000 },
  /* CI だけが実行するステップ (ドリフト検出の警告から除外するため登録だけしておく) */
  { ciName: "Install Playwright browsers", label: "(CI のみ) browser install", ciOnly: true },
];

const tail = (s, n = 40) => s.split("\n").slice(-n).join("\n");

async function main() {
  const startedAt = new Date();
  console.log(`${C.bold}verify${C.reset} ${C.dim}(${noBuild ? "--no-build" : "full"}, ${steps.length} steps)${C.reset}\n`);

  const results = [];
  for (const step of steps) {
    if (step.ciOnly) {
      results.push({ ciName: step.ciName, label: step.label, status: "ci-only", ms: 0 });
      console.log(`${C.dim}− ${step.label}${C.reset}`);
      continue;
    }
    if (noBuild && step.needsBuild) {
      results.push({
        ciName: step.ciName,
        label: step.label,
        status: "skipped",
        ms: 0,
        reason: "--no-build (ビルド成果物に依存)",
      });
      console.log(`${C.dim}− ${step.label} (skipped: --no-build)${C.reset}`);
      continue;
    }
    process.stdout.write(`${C.dim}… ${step.label}${C.reset}\r`);
    let r;
    if (step.run) {
      const t = Date.now();
      const res = await step.run();
      r = { code: res.code, ms: Date.now() - t, out: res.out };
    } else {
      r = await runStep(step.cmd, step.args);
    }
    const ok = r.code === 0;
    results.push({ ciName: step.ciName, label: step.label, status: ok ? "pass" : "fail", ms: r.ms, exitCode: r.code });
    const secs = (r.ms / 1000).toFixed(1);
    console.log(`${ok ? C.green + "✓" : C.red + "✗"} ${step.label}${C.reset} ${C.dim}${secs}s${C.reset}`);
    if (!ok) {
      console.log(C.dim + "  ┌─ last output ─" + C.reset);
      for (const line of tail(r.out).split("\n")) console.log(`  │ ${line}`);
      console.log(C.dim + "  └─" + C.reset + "\n");
    }
  }

  // CI ドリフト検出: ci.yml にあって verify が知らないステップ
  const known = new Set(steps.map((s) => s.ciName));
  const ciNames = ciStepNames();
  const uncovered = ciNames.filter((n) => !known.has(n));
  if (uncovered.length) {
    console.log(`\n${C.yellow}⚠ ci.yml に verify 未追従のステップ:${C.reset}`);
    for (const n of uncovered) console.log(`  - ${n}`);
    console.log(`${C.dim}  → scripts/verify.mjs の steps に追加してください${C.reset}`);
  }

  const failed = results.filter((r) => r.status === "fail");
  const totalMs = Date.now() - startedAt.getTime();
  const report = {
    startedAt: startedAt.toISOString(),
    durationMs: totalMs,
    mode: noBuild ? "no-build" : "full",
    ok: failed.length === 0,
    steps: results,
    ciDrift: uncovered,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(path.join(REPORT_DIR, "latest.json"), JSON.stringify(report, null, 2));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const summary = `${results.filter((r) => r.status === "pass").length}/${results.filter((r) => r.status === "pass" || r.status === "fail").length} passed · ${(totalMs / 1000).toFixed(1)}s`;
  console.log(`\n${failed.length === 0 ? C.green + "OK" : C.red + "FAIL"} ${C.reset}${summary}`);
  if (failed.length) console.log(`${C.red}赤: ${failed.map((f) => f.label).join(", ")}${C.reset}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
