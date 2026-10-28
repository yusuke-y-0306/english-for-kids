#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions -- 確認スクリプトは `cond ? ok() : ng()` の形で結果を並べる */
/**
 * #31 の受け入れ確認。SpeechRecognition をスタブして「クラウド経路に入らないこと」を検証する。
 * CI では実行しない (手動)。
 *
 * 前提:
 *   1) NODE_ENV=development npx next dev -p 3311
 *   2) PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/dev/recognition-policy-e2e.mjs
 *
 * 注意: headless Chrome の実物 SpeechRecognition は available() を呼ぶとレンダラが落ちるため、
 *       スタブで実物を消してから検証している (アプリ側のコードパスだけを見る)。
 */
// Playwright は devDependency に入れていない (CI では動かさない手動確認用)。
// 使い方: PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/dev/recognition-policy-e2e.mjs
const playwrightPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const { chromium } = await import(playwrightPath);

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3311/dev/recognition-check';
const results = [];
const ok = (n, x = '') => { results.push(`OK   ${n}`); console.log('OK  ', n, x); };
const ng = (n, x = '') => { results.push(`NG   ${n}`); console.log('NG  ', n, x); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUB = ({ flavor }) => {
  // 実物の SpeechRecognition は headless で available() を呼ぶとレンダラが落ちるので、
  // まず実物を消してからスタブを差す (アプリ側のコードパスだけを検証する)
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;

  const rec = (window.__rec = { constructed: 0, started: 0, processLocallyAtStart: null, lang: null });
  if (flavor === 'none') return;

  function Instance() {
    rec.constructed += 1;
    const self = {
      lang: 'ja-JP',
      continuous: true,
      interimResults: true,
      onresult: null, onerror: null, onend: null,
      start() {
        rec.started += 1;
        rec.processLocallyAtStart = self.processLocally === true;
        rec.lang = self.lang;
        setTimeout(() => {
          if (flavor === 'error-network') { self.onerror?.({ error: 'network' }); self.onend?.(); }
          else { self.onresult?.({ resultIndex: 0, results: [[{ transcript: 'elephant' }]] }); self.onend?.(); }
        }, 40);
      },
      stop() {}, abort() {},
    };
    return self;
  }

  function Ctor() { return new Instance(); }

  if (flavor !== 'safari-like') {
    // 端末内モードを持たない実装 (Safari) を模す場合は prototype に定義しない
    Object.defineProperty(Ctor.prototype, 'processLocally', { value: false, writable: true, configurable: true });
    Ctor.available = () => Promise.resolve(flavor === 'downloadable' ? 'downloadable' : 'available');
    if (flavor === 'slow-available') Ctor.available = () => new Promise(() => {});
    window.SpeechRecognition = Ctor;
  } else {
    window.webkitSpeechRecognition = Ctor;
  }
};

async function scenario(flavor, fn) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const external = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.push(r.url()); });
  await page.addInitScript(STUB, { flavor });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /path=(wasm|device|self-report)/.test(document.querySelector('#report')?.textContent ?? ''), null, { timeout: 60000 });
  const report = async () => Object.fromEntries(
    (await page.evaluate(() => document.querySelector('#report').textContent))
      .split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const rec = () => page.evaluate(() => window.__rec);
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  try { await fn({ page, report, rec, click, external }); } finally { await browser.close(); }
}

// 1) 認識APIが無い端末
await scenario('none', async ({ report, click }) => {
  const r = await report();
  r.path === 'self-report' ? ok('認識APIなし → self-report', r.reason) : ng('認識APIなし', JSON.stringify(r));
  r.present === 'false' ? ok('present=false') : ng('present', r.present);
  await click('1回認識');
  await sleep(400);
  const r2 = await report();
  r2.result.startsWith('error: not-local') ? ok('1回認識しても生成しない', r2.result) : ng('1回認識の結果', r2.result);
});

// 2) Safari 相当: processLocally も available も無い → 絶対に使わない
await scenario('safari-like', async ({ report, rec, click }) => {
  const r = await report();
  r.path === 'self-report' ? ok('Safari相当 (processLocally 無し) → self-report', r.reason) : ng('Safari相当', JSON.stringify(r));
  r.hasProcessLocally === 'false' ? ok('hasProcessLocally=false') : ng('hasProcessLocally', r.hasProcessLocally);
  await click('1回認識');
  await sleep(400);
  const s = await rec();
  s.started === 0 ? ok('認識を開始していない (start 0 回)') : ng('認識の開始', `started=${s.started}`);
  const r2 = await report();
  r2.result.startsWith('error: not-local') ? ok('クラウド経路に入らない', r2.result) : ng('結果', r2.result);
});

// 3) processLocally はあるが端末内データ未取得 (downloadable)
await scenario('downloadable', async ({ report, rec, click }) => {
  const r = await report();
  r.path === 'self-report' ? ok('端末内データ未取得 → self-report', r.reason) : ng('downloadable', JSON.stringify(r));
  r.availability === 'downloadable' ? ok('availability=downloadable を検出') : ng('availability', r.availability);
  await click('1回認識');
  await sleep(400);
  (await rec()).started === 0 ? ok('認識を開始していない') : ng('downloadable で開始された');
});

// 4) 端末内認識が使える → device 経路で processLocally=true を強制
await scenario('available', async ({ page, report, rec, click }) => {
  const r = await report();
  r.path === 'device' ? ok('端末内認識が使える → device', r.reason) : ng('device 経路', JSON.stringify(r));
  await click('1回認識');
  await page.waitForFunction(() => (document.querySelector('#report')?.textContent ?? '').includes('result=ok'), null, { timeout: 15000 });
  const r2 = await report();
  r2.result === 'ok: elephant' ? ok('認識結果を取得', r2.result) : ng('認識結果', r2.result);
  const s = await rec();
  s.started === 1 ? ok('start は 1 回だけ') : ng('start 回数', String(s.started));
  s.processLocallyAtStart === true ? ok('start 時点で processLocally=true') : ng('processLocally', String(s.processLocallyAtStart));
  s.lang === 'en-US' ? ok('lang=en-US を強制') : ng('lang', String(s.lang));
  page && (await page.evaluate(() => true));
});

// 5) 端末内認識がエラー (network) → リトライしない
await scenario('error-network', async ({ page, report, rec, click }) => {
  await click('1回認識');
  await page.waitForFunction(() => (document.querySelector('#report')?.textContent ?? '').includes('result=error'), null, { timeout: 15000 });
  const r = await report();
  r.result === 'error: failed:network' ? ok('network エラーを検出', r.result) : ng('エラー結果', r.result);
  const s = await rec();
  s.started === 1 ? ok('リトライしていない (start 1 回)') : ng('リトライ', String(s.started));
});

// 5.5) available() が返らない実装 → 1.5 秒で打ち切り self-report
await scenario('slow-available', async ({ report }) => {
  await sleep(2200);
  const r = await report();
  r.path === 'self-report' ? ok('available() が返らない実装は self-report に落とす', r.reason) : ng('タイムアウト時の経路', JSON.stringify(r));
});

// 6) 外部オリジンへのリクエストが無いこと (スタブ下での確認)
await scenario('available', async ({ page, click, external }) => {
  await click('1回認識');
  await sleep(1500);
  external.length === 0 ? ok('外部オリジンへのリクエスト 0 件') : ng('外部リクエスト', external.join(','));
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('main span')).map((s) => s.textContent));
  texts.some((t) => t && t.includes('端末内で よみとり'))
    ? ok('画面に「端末内で よみとり」を表示')
    : ng('バッジ表示', texts.join(' | '));
});

console.log('\n=== 結果 ===');
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('NG')) ? 1 : 0);
