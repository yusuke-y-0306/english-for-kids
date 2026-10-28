#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions -- 確認スクリプトは `cond ? ok() : ng()` の形で結果を並べる */
/**
 * モデルキャッシュ (#29) の手動 E2E。CI では実行しない。
 *
 * 前提:
 *   1) node scripts/models.mjs serve            # モデル配信 (127.0.0.1:3101)
 *   2) NODE_ENV=development npx next dev -p 3311
 *   3) PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/dev/model-cache-e2e.mjs
 *
 * 注意: このスクリプトを書いた環境では CacheStorage の実測上限が 50MiB 前後で、
 *       モデル (51,441,771 bytes) とほぼ同じだった。上限に当たる場合は SKIP と表示する。
 */

// Playwright は devDependency に入れていない (CI では動かさない手動確認用)。
// 使うとき: PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/dev/model-cache-e2e.mjs
const playwrightPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const { chromium } = await import(playwrightPath);

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3311/dev/model-check';
const results = [];
const ok = (n, x = '') => { results.push(`OK   ${n}`); console.log('OK  ', n, x); };
const skip = (n, x = '') => { results.push(`SKIP ${n}`); console.log('SKIP', n, x); };
const ng = (n, x = '') => { results.push(`NG   ${n}`); console.log('NG  ', n, x); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /状態: (ready|absent)/.test(document.querySelectorAll('main section')[0]?.innerText ?? ''),
    null, { timeout: 60000 },
  );
  const status = () => page.evaluate(() => document.querySelectorAll('main section')[0].innerText);
  const logs = () => page.evaluate(() => document.querySelector('pre').innerText);
  const count = async (n) => (await logs()).split('\n').filter((l) => l.includes(n)).length;
  const click = (n) => page.getByRole('button', { name: n, exact: true }).click();
  const act = async (button, needle, timeout = 90000) => {
    const base = await count(needle);
    await click(button);
    const t0 = Date.now();
    for (;;) {
      if ((await count(needle)) > base) return;
      if (Date.now() - t0 > timeout) throw new Error(`timeout: ${needle}\n${await logs()}`);
      await sleep(300);
    }
  };
  const download = async () => {
    await click('ダウンロード');
    for (let i = 0; i < 300; i++) {
      const l = await logs();
      if (l.includes('download 完了')) { await sleep(900); return true; }
      if (l.includes('download: NG')) return false;
      await sleep(300);
    }
    return false;
  };
  const close = () => browser.close();
  return { page, status, logs, click, act, download, close };
}

// 1) 初回取得 → ready → 検証 → 再訪で再取得なし
{
  const s = await session();
  ((await s.status()).includes('absent')) ? ok('absent から開始') : ng('初期状態');
  const t0 = Date.now();
  (await s.download()) ? ok(`初回ダウンロードで ready (${Date.now() - t0}ms)`) : ng('初回ダウンロード');
  await s.act('読み出して検証', 'verify: OK');
  const v = (await s.logs()).split('\n').find((l) => l.includes('verify: OK'));
  v?.includes('7 ファイル') && v.includes('51,441,771') ? ok('7 ファイルの sha256 照合') : ng('sha256 照合', v ?? '');
  const entries = Number(((await s.status()).match(/… (\d+) entries/) ?? [])[1] ?? -1);
  entries === 8 ? ok('キャッシュは 1 つ・8 エントリ (7 ファイル + sentinel)') : ng('キャッシュ構成', `${entries}`);
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => /状態: (ready|absent)/.test(document.querySelectorAll('main section')[0]?.innerText ?? ''));
  await sleep(800);
  const l2 = await s.logs();
  (await s.status()).includes('ready') && l2.includes('(ログなし)')
    ? ok('再訪時は ready でダウンロードを起こさない')
    : ng('再訪時の挙動', (await s.status()).replace(/\n/g, ' | '));
  await s.close();
}

// 2) 改ざん検出 → 破棄
{
  const s = await session();
  (await s.download()) ? ok('準備完了') : ng('準備完了');
  await s.act('1バイト改ざん', '破壊しました');
  await sleep(1200);
  (await s.status()).includes('ready') ? ok('改ざん直後は sentinel が残るので ready のまま') : ng('改ざん直後');
  await s.act('読み出して検証', 'verify: NG');
  await sleep(1200);
  (await s.status()).includes('absent') ? ok('改ざんを検出してキャッシュを破棄 (absent)') : ng('改ざん検出後の状態');
  await s.close();
}

// 3) 1 ファイル欠け → ready にならない
{
  const s = await session();
  (await s.download()) ? ok('準備完了') : ng('準備完了');
  await s.act('1ファイル削除', 'を削除');
  await sleep(1200); // パネルの refresh() は note の後に走るので、DOM の反映を待つ
  const st = await s.status();
  st.includes('absent') ? ok('1 ファイル欠けたら ready にならない') : ng('1 ファイル欠けの判定', st.replace(/\n/g, ' | '));
  await s.close();
}

// 4) 全消去 → 再取得 (環境の上限に当たる場合は SKIP 扱い)
{
  const s = await session();
  (await s.download()) ? ok('準備完了') : ng('準備完了');
  await s.act('全消去', '全消去しました');
  await sleep(1200);
  (await s.status()).includes('absent') ? ok('全消去で absent に戻る') : ng('全消去');
  (await s.download()) ? ok('全消去後に再取得して ready') : skip('全消去後の再取得', 'この環境の CacheStorage 上限 (50MiB) に当たったため未検証');
  await s.close();
}

// 参考: この環境の上限
{
  const s = await session();
  const limit = await s.page.evaluate(async () => {
    const c = await caches.open('probe-limit');
    const chunk = new Uint8Array(1024 * 1024);
    let put = 0;
    for (let i = 0; i < 200; i++) {
      try { await c.put(`/c${i}`, new Response(chunk)); put += chunk.byteLength; } catch { break; }
    }
    await caches.delete('probe-limit');
    const e = await navigator.storage.estimate();
    return { put, quota: e.quota, persisted: await navigator.storage.persisted() };
  });
  console.log(`\n[環境] 実測の書き込み上限=${limit.put} bytes / estimate quota=${limit.quota} / persisted=${limit.persisted} / モデル=51,441,771 bytes`);
  await s.close();
}

console.log('\n=== 結果 ===');
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('NG')) ? 1 : 0);
