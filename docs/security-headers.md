# セキュリティヘッダと CSP (issue #33)

このアプリは **COOP/COEP を「実行要件」として必要とする** (モデル推論で `SharedArrayBuffer` /
高精度タイマーを使うため)。COOP/COEP は XSS を防がないので、**CSP とセットで初めて釣り合う**。
cross-origin isolation を有効にすると、万一 XSS を許したときに攻撃者の武器が増えるからだ。

## どこで何を設定しているか

| 何 | どこ | 理由 |
| --- | --- | --- |
| CSP | `src/proxy.ts` (+ `src/lib/security/csp.ts`) | nonce がリクエストごとに変わるため |
| HSTS / XFO / nosniff / Referrer-Policy / Permissions-Policy / COOP / COEP / CORP | `next.config.ts` | 値が固定 |
| `X-Powered-By` の削除 | `next.config.ts` (`poweredByHeader: false`) | サーバ種別を晒さない |

### なぜ CSP だけ proxy.ts なのか

Next.js の App Router は HTML に **inline script** (`self.__next_f.push(...)`) を埋め込む。
`script-src 'self'` だけではこれが実行できず **ハイドレーションしない**。
`'unsafe-inline'` を足すと CSP の意味がほぼ消えるので、**nonce** を使う。

Next.js は **リクエストの CSP ヘッダ**から nonce を読み取り、自前の script に付与する
(`next/dist/server/app-render/get-script-nonce-from-header.js`)。だから proxy は:

1. nonce を作る
2. **リクエストヘッダ**に CSP を積む (`NextResponse.next({ request: { headers } })`)
3. **レスポンスヘッダ**にも同じ CSP を付ける

Next.js 16 で `middleware.ts` は `proxy.ts` に改名された (middleware は非推奨)。

### CSP の中身

```
default-src 'self';
script-src 'self' 'nonce-<毎リクエスト>' 'wasm-unsafe-eval';
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
media-src 'self' blob:;
worker-src 'self' blob:;
manifest-src 'self';
connect-src 'self' https://yusuke-y-0306.github.io/english-for-kids/models/tiny-streaming-en/<版>-<指紋>/;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
```

- **`'wasm-unsafe-eval'` は必須**。無いと WASM のコンパイルが失敗し、推論だけが
  **無言で**死ぬ (例外は出ず、コンソールに 1 行出るだけ)。だから `npm run headers:check` で
  存在を固定している。
- **`connect-src` が「音声もテキストも外部に送っていない」ことの機械的な証明**になる
  (issue #2 レビュー 高-3)。唯一の外部オリジンはモデル配信元で、しかも
  **モデルのディレクトリまで**絞ってある。値は `src/lib/speech/model-origin.ts` と
  `model-manifest.ts` から導出しているので、モデルを更新すれば CSP も自動で追従する。
- `style-src 'unsafe-inline'` は Tailwind / Next が style を inline で差し込むため (実測)。
  ここは残る弱みだが、`script-src` は nonce 方式なので XSS の主要な入口は塞がっている。

## 検証 1: ヘッダのスモークテスト (CI で毎 PR 実行)

```bash
npm run build
npm run start -- -p 3100 &
BASE_URL=http://127.0.0.1:3100 npm run headers:check
```

`scripts/check-headers.mjs` は「付いている」だけでなく **壊れやすい約束**を固定する:

- `'unsafe-inline'` が script-src に戻ってきたら失敗
- `'wasm-unsafe-eval'` が消えたら失敗
- `connect-src` にモデル配信元以外が増えたら失敗
- inline script に nonce が付いていなければ失敗
- 外部オリジンの `<script src>` があれば失敗

**必ず `next start` (production build) に対して実行する**。`next dev` は HMR 用に
`'unsafe-eval'` と `ws://` を足しているので、本番の姿を映さない。

## 検証 2: ブラウザでの確認 (リリース前 / ヘッダを変えたとき)

`crossOriginIsolated` と CSP 違反 0 件は HTTP ヘッダだけでは分からないので、実ブラウザで見る。
**必ず report-only で先に流す** (いきなり enforce にしない)。

### 1. report-only で起動する

```bash
CSP_REPORT_ONLY=1 npm run start -- -p 3100
# ヘッダ名が Content-Security-Policy-Report-Only になる。nonce は同じ仕組みで付く。
```

### 2. 全ページを開いてコンソールを見る

```js
// 例: ログイン済みの cookie を渡して 1 ページずつ開く
const { chromium } = require("playwright"); // ローカルのみ (依存には入れていない)
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "efk_session", value: process.env.EFK_SESSION, domain: "127.0.0.1", path: "/" }]);
for (const path of ["/", "/login", "/flashcards", "/build", "/quiz"]) {
  const page = await ctx.newPage();
  const msgs = [];
  page.on("console", (m) => msgs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => msgs.push(`pageerror: ${e.message}`));
  await page.goto(process.env.BASE_URL + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  console.log(path, await page.evaluate(() => self.crossOriginIsolated), msgs.filter((m) => /content security policy/i.test(m)));
  await page.close();
}
```

確認すること:

- CSP 違反のログが **0 件** (report-only でもブラウザは violation をコンソールに出す)
- `crossOriginIsolated === true`
- 発音練習ページを開いても `connect-src` 違反が出ない (= 外部通信が無い)
- モデル取得 (`/dev/model-check`) が **COEP require-corp 下でも成功する**

### 3. enforce に切り替えて同じ確認

`CSP_REPORT_ONLY` を外して起動し、同じ手順で 0 件を再確認する。
違反が出たら **enforce のままにせず**、CSP を直してから report-only に戻す。

### 4. セッション cookie を自分で作る方法 (パスキーなしで確認したいとき)

```bash
SECRET="..."   # SESSION_SECRET と同じ値
node -e '
const crypto=require("node:crypto");
const secret=process.argv[1], now=Math.floor(Date.now()/1000);
const body=Buffer.from(JSON.stringify({uid:"u_xxx",iat:now,exp:now+3600})).toString("base64url");
console.log(body+"."+crypto.createHmac("sha256",secret).update(body).digest("base64url"));
' "$SECRET"
```

`AUTH_DATA_DIR` を一時ディレクトリに向けた検証用インスタンスを立てると、本番のデータを触らずに済む。

## 落とし穴 (実際に踏んだもの)

- **CSP のパス一致は「末尾が `/` なら前方一致、そうでなければ完全一致」**。
  `connect-src https://host/app` は `/app/models/...` に**一致しない**。
  最初これでモデル取得が全部ブロックされた (report-only のドリルで即座に見つかった)。
- **`upgrade-insecure-requests` は localhost では付けない**。付けると `http://127.0.0.1:3100` の
  サブリソースが https に書き換えられ、ローカル確認が壊れる (`src/proxy.ts` で判定)。
- **proxy の matcher から `_next/` を外す**。`/_next/hmr` (WebSocket) に proxy が挟まると
  dev の HMR が壊れる。

## 既知の制約 / 残課題

- `/dev/model-check` と `/dev/recognition-check` は production build にも含まれる
  (CSP は効いているが、公開してよいページかは別問題)。別 issue で扱う。
- `style-src 'unsafe-inline'` は残している (上記)。
- CSP レポートの収集先 (`report-to`) は未設定。report-only ドリルはコンソールで見る運用。
