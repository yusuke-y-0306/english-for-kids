# 検証ハーネス (harness engineering) — 方針メモ

「機能を足す」より先に「**足した機能が壊れていないことを機械が言える**」状態を作る。
目的は 2 つ。

1. **人間 (Yusuke) が確認しなくても緑/赤が分かる** — 目視に戻らない
2. **エージェントが 1 回の実行で修正対象を把握できる** — 赤を全部並べて返す

## 現状 (2026-11-22 時点)

CI (`.github/workflows/ci.yml`) は既に強い。typegen / tsc / lint / models / vocabulary /
audio / build / asr-assets / headers / unit+api の 10 項目。

足りないのは「入口」と「階層」。

| 層 | 状態 |
| --- | --- |
| L1 静的検証 (型・lint・コンテンツ・アセット) | ✅ CI に有り |
| L1' ローカル入口 (`npm run verify`) | ✅ 追加 (2026-11-22) |
| L2 単体・API テスト | ✅ 29 ファイル |
| L3 ブラウザ E2E (フラッシュカード→クイズ→進捗) | ✅ 追加 (2026-11-22) / 4 本 |
| L4 計測 (所要時間・flake・カバレッジ) | ❌ 未着手 (`verify` と e2e が JSON を残すところまで) |

## 運用

```bash
npm run verify       # フル (build・ヘッダ・API・E2E まで) ~135s。**マージゲート**
npm run verify:fast  # 高速 (型・lint・コンテンツ・単体テスト) ~35s。マージ不可
npm run test:e2e     # E2E だけ (build 済みであること)
```

結果は `.verify/latest.json` に残る (失敗ステップ・所要時間)。`ci.yml` に
ステップが増えると「未追従」を警告する — **CI とローカルのドリフト検出**。

## E2E (L3) の設計

- **認証は cookie を直に置く。** パスキー (WebAuthn) はブラウザの認証器が要るので
  E2E では扱わない。`scripts/e2e/prepare.mjs` が署名済みセッション cookie と
  専用データディレクトリ (`.e2e/data`) を作り、`storageState` として読ませる。
  門番 (proxy) の判定は本物のセッションと同じ経路を通るので、認可の検証には十分。
- **環境を固定する。** UA・タイムゾーン (Asia/Tokyo)・workers=1 (同じ子のデータを
  共有するため)。ここを緩めると「たまに落ちるテスト」になる。
- **宛先は `data-testid`。** 表示文言 (ひらがな) は変わりうるので、E2E が壊れる
  理由を「文言を直したから」にしない。
- 見るのは結線だけ。正誤のロジックは単体テストの担当 (重複させない)。

### ローカルでブラウザが動かないとき

Linux に GUI 用の共有ライブラリが無いと `libatk-1.0.so.0` などで落ちる。
root があるなら `npx playwright install-deps chromium` が早い。root が無い環境では
必要な .deb を展開して `~/.local/lib/playwright-deps` に置けば動く
(`scripts/verify.mjs` がそのディレクトリを検出して `LD_LIBRARY_PATH` に足す):

```bash
mkdir -p /tmp/pwlibs && cd /tmp/pwlibs
apt-get download libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
  libgbm1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxi6 libxrender1
for f in *.deb; do dpkg-deb -x "$f" ~/.local/lib/playwright-deps; done
```

CI (GitHub ホステッドランナー) は `playwright install --with-deps chromium` で
システム側に入れるので、この回避策は要らない。

## 踏んだ罠 (記録)

- **API テストは `.next` に依存する。** 古いビルドのまま `test:api` を回すと、
  コードは正しいのに `categories.length` が 16 vs 15 で落ちる「偽の赤」が出る。
  → `verify:fast` では `test:api` を実行しない (単体テストのみ) ようにした。
- **速いモードは「弱い」。** 緑の意味が変わるなら、それは別のコマンドとして扱うべき。
  そこで `--no-build` を `--fast` / `npm run verify:fast` に改名し、出力を
  `PARTIAL` (黄色) にして「マージゲートではない」ことを結果そのものに書いた
  (`mergeGate` フィールドも JSON に残す)。旧 `--no-build` は警告付きで通す。
- **E2E の失敗は 3 種類に分かれる。** アプリのバグ / 環境の欠け / セレクタの
  ドリフト。今回踏んだのは環境の欠け (共有ライブラリ) で、テストの中身は最初から
  正しかった。赤を見たら、まず「どの種類か」を決める。

## 次の一手

1. **L3 を広げる** — 発音 (`/pronunciation`) は音声入力のモックが要る
   (`--use-fake-device-for-media-stream` + ASR のスタブ) で 1 本。ログイン
   (パスキー) は CDP の WebAuthn エミュレーションで 1 本。
2. **L4: 計測** — `verify` の JSON を日次で 1 行に潰し、所要時間の推移と
   flake 率を見る。テストの所要時間が伸びるのは、たいてい結合度が上がったサイン。
3. **タスク仕様の型** — issue に「受け入れ条件 → 対応する verify ステップ」を
   書く欄を設ける。条件とチェックが 1:1 でない issue は、着手前に分割する。

## 原則

- **赤を握り潰さない。** flaky はテストではなくハーネスのバグとして直す。
- **一度に 1 変数。** 検証を足すときも、測る対象を 1 つに絞る。
- **緑の意味を薄めない。** スキップしたステップは必ず表示する。
