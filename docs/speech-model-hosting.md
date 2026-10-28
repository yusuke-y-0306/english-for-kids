# 音声モデルのホスティング (issue #30 / 案 A)

ブラウザ内 WASM 推論で使う Moonshine のモデル (約 50MB) を **アプリとは別オリジン**から配るための
決定と運用手順。実装は `src/lib/speech/model-origin.ts` と `scripts/models.mjs`。

## 決定

| 項目 | 決定 |
|---|---|
| 方式 | **A: アプリとは別オリジンの静的配信** |
| ホスト | **GitHub Pages** (`gh-pages` ブランチ / パスは `models/...`) |
| 本番 URL | `https://yusuke-y-0306.github.io/english-for-kids/models/tiny-streaming-en/q8_2026-07-30-<hash8>/` |
| 開発 URL | `http://127.0.0.1:3101/...` (`node scripts/models.mjs serve`) |
| 信頼の起点 | `src/lib/speech/model-manifest.ts` に固定した **sha256**（ホストは信頼しない） |

## なぜこの形なのか

- **同一オリジンに置くと被害範囲が広がる。** モデルは Cache Storage に永続化され、同一オリジンの
  JS から書き換えられる。アプリと同居させると XSS 一つで「セッションと同じ信頼境界」のまま
  モデルを差し替えられ、しかも `navigator.storage.persist()` で消えにくくなる。
  オリジンを分ければ汚染はモデル側に閉じ込められる（アプリ側の cookie / セッションには触れない）。
- **main に 50MB を置かない。** リポジトリの `.git` は現在数 MB。バイナリを入れると履歴から
  消せなくなる。`gh-pages` は生成専用ブランチなので履歴を気にしなくてよい。
- **実行時に URL を組み立てない。** `MODEL_ORIGIN` はコード内の定数。環境変数やクエリで
  差し替えられる経路を作らない（差し替えは必ずレビュー済みの diff にする）。

## 検討して落とした案

- **同一オリジン (`public/models/`)**: XSS 時の影響が大きい。`git reset --hard` だけの現行デプロイでは
  デプロイ時に落としたファイルが残留し、汚染が消えない。→ 不採用。
- **GitHub Releases のアセット**: 実測で `access-control-allow-origin` が付かず、ブラウザの `fetch`
  が CORS で失敗する（`objects.githubusercontent.com` にリダイレクトされる）。→ 不可。
- **第三者 CDN (`download.moonshine.ai` 直参照)**: 完全性・可用性・プライバシー（利用時刻と IP が
  第三者に渡る）の全てで不利。取得はビルド/公開時の 1 回だけにする。→ 不採用。
- **自分のドメイン + 名前付きトンネル**: 理想だが、このホストには独自ドメインも Cloudflare
  アカウントも無い。取得後に `PRODUCTION_ORIGIN` を 1 行変えるだけで移行できる形にしてある。

## 運用手順

```sh
# 1. 上流 (Moonshine カタログ) から取得 — models-cache/ は git 管理外
node scripts/models.mjs fetch

# 2. 初回だけ: sha256 を確定して manifest を生成 (差分を必ずレビュー)
node scripts/models.mjs manifest --init

# 3. 検証 (CI でも実行)
node scripts/models.mjs verify
node scripts/models.mjs check

# 4. 公開 (gh-pages へ force push)
node scripts/models.mjs publish

# 5. 公開 URL の到達性とサイズを確認
node scripts/models.mjs check --remote
```

初回のみ、リポジトリ設定で **Settings > Pages > Build and deployment > Deploy from a branch:
`gh-pages` / `/ (root)`** を有効化する必要がある（bot の権限では設定できない）。

### モデルを更新するとき

1. `scripts/models/source.json` の `variant` と `sourceUrl` を新しいカタログに合わせる
2. `fetch` → `manifest --init` → `verify`
3. **sha256 の差分を PR でレビュー**（ここが trust anchor。ここを素通りさせると意味が無い）
4. `publish` → PR をマージ

`MODEL_PATH_PREFIX` にはハッシュの先頭 8 文字が入るため、内容が変われば URL も変わる。
古いパスは残るが、`AssetDownloader` のキャッシュ名も `MODEL_SET_HASH` 由来にする（issue #29）ことで
古いキャッシュを確実に捨てる。

## 何がどこから来るか（オリジンの分担）

| 成果物 | サイズ | 配信元 |
|---|---|---|
| `moonshine.wasm`（推論エンジン本体。VAD も内蔵） | 13,155,937 bytes | **アプリと同じオリジン**（`npm ci` → Next の静的アセット `/_next/static/media/moonshine.<hash>.wasm`） |
| `moonshine.mjs`（Emscripten のグルー） | 156,457 bytes | 同上（バンドルに含まれる） |
| モデル 7 ファイル（`encoder.ort` ほか） | 51,441,771 bytes | **別オリジン**（GitHub Pages） |

エンジン（wasm）は**コード**なので、アプリと同じ信頼境界に置くのが正しい。分けると次の問題が出る:
`moonshine.wasm` の位置は、既定では `new URL("moonshine.wasm", import.meta.url)` で解決される。
`locateFile` を明示的に渡すと `scriptDirectory + path` 経路に変わり、`import.meta.url` が `blob:` に
なる文脈（クロスオリジンの pthread worker）では自前で固定しないと解決できない。
つまり **wasm を別オリジンに出すと、この分岐に踏み込んで worker が壊れやすい**。だから動かさない。

一方モデルはデータなので、汚染されてもセッションに波及しないよう別オリジンに隔離する（本ドキュメントの主題）。

### 実装時に確認すること（#2 / #33）

- Network に `/_next/static/media/moonshine.<hash>.wasm` が出る（404 が無い）
- CSP は `script-src 'self' 'wasm-unsafe-eval'`、worker は同一オリジンなので `worker-src 'self'` で足りる
  （`blob:` が要るのはクロスオリジン配信にした場合だけ）
- `locateFile` を渡す実装にしない（渡すなら `public/` に置いて明示パスにする）

## ライセンス / 帰属

- `@moonshine-ai/moonshine-wasm` は MIT。
- モデル重みの再配布条件は上流のリポジトリ / モデルカードで確認すること。
  確認できるまで `publish` は「私的利用の範囲」に留める。

## 帯域の目安

- 1 台あたり初回 51,441,771 bytes。以後は Cache Storage から読むのでゼロ。
- GitHub Pages の推奨上限は 1GB/サイト・100GB/月。家庭内利用の規模では問題にならない。

## 既知の制約

- **GitHub Pages は `Cache-Control` を指定できない**（実測: `max-age=600`、`Vary: Accept-Encoding`）。
  `immutable` を前提にした HTTP キャッシュ設計は使えないので、**再取得の抑制は Cache Storage（#29）側で行う**。
  完全性も HTTP キャッシュではなく manifest の sha256 で担保する。
- **`Vary: Accept-Encoding` により `content-length` は圧縮後のサイズになりうる**（実測: `streaming_config.json`
  は 509 → 234 bytes）。`models:check --remote` は `Accept-Encoding: identity` を明示して比較している。

- 本番 URL は GitHub に依存する。GitHub 障害時、**未キャッシュの端末**はモデルを取得できない
  （キャッシュ済みなら動く）。可用性を上げたくなったら独自ドメイン + 自前配信へ移行する。
- `github.io` をブロックするネットワークでは初回取得に失敗する。その場合も
  「自己申告モード」で学習は継続できる（issue の方針 6）。
