import { defineConfig, devices } from "@playwright/test";
import {
  BASE_URL,
  DATA_DIR,
  E2E_PORT,
  MASTER_KEY,
  REPORT_FILE,
  SESSION_SECRET,
  STATE_FILE,
  USER_AGENT,
} from "./scripts/e2e/constants.mjs";

/**
 * E2E ハーネスの設定。
 *
 * 方針:
 *  - **環境を固定する** (ここが本体)。UA・タイムゾーン・データ置き場・シードを
 *    決め打ちにしないと、E2E は「たまに落ちるテスト」になる。
 *  - ブラウザは chromium のみ。増やすのは、実際に Safari 固有の不具合を
 *    踏んだときでいい。
 *  - 失敗時は trace を残す (スクリーンショットより再現性が高い)。
 *
 * 前段のフィクスチャ作成は `node scripts/e2e/prepare.mjs` (npm run test:e2e が実行)。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* 同じユーザーのデータを共有するので並列にしない */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: REPORT_FILE }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    userAgent: USER_AGENT,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    storageState: STATE_FILE,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- -p ${E2E_PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_DATA_DIR: DATA_DIR,
      SESSION_SECRET,
      USERPOOL_MASTER_KEY: MASTER_KEY,
      /* 発音の自動再生や音声認識で外部に出ないようにする (E2E では使わない) */
      NEXT_PUBLIC_E2E: "1",
    },
  },
});
