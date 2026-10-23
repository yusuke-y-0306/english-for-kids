# English for Kids 🧒📚

子供向け英語学習アプリケーション。

## 概要

- **目的:** 子供たちが楽しく英語を学べるプラットフォーム
- **ステータス:** 開発中 (Next.js)

## 技術スタック

- **フレームワーク:** Next.js (App Router)
- **言語:** TypeScript
- **スタイリング:** Tailwind CSS
- **将来拡張:** API Routes / 音声認識 (Web Speech API) / PWA

## 機能

- [x] 英単語フラッシュカード (#1)
- [ ] 発音練習・音声認識 (#2)
- [x] クイズ・ゲーム (#3)
- [ ] 進捗管理 (#4)
- [x] ログイン（生体認証 / FIDO2・パスキー）(#23)

チケット管理は GitHub Issues で運用: https://github.com/yusuke-y-0306/english-for-kids/issues

## 公開サイト 🌐

Cloudflare Quick Tunnel を使っているため、URL は cloudflared の再起動時に変わることがあります。
**最新URLは常にこちら**（ページの中身が自動更新されます）:

- Deployments (environment: `production`) — https://github.com/yusuke-y-0306/english-for-kids/deployments
- 各デプロイの Actions **Job Summary** にも `🚀 Live site:` として表示

## セットアップ

```bash
npm install
npm run dev
```

開発サーバー: http://localhost:3000

## 開発コマンド

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm start` | 本番サーバー起動 |
| `npm run lint` | ESLint チェック |
| `npm run auth:keygen` | 認証用の鍵（マスター鍵・セッション鍵）を生成 |
| `npm run auth:users` | ユーザープールの中身を確認（読み取りのみ） |

## ログイン機能（#23）

子どもは **ID / パスワードを入力しません**。アバターをタップして、
端末の指紋・顔（FIDO2 / パスキー、WebAuthn）でログインします。

### 構成

- **ユーザープールはテキストファイル** — `data/users.json`（DB は使いません）
- 各ユーザーの「秘密」（保護者パスフレーズ）は **AES-256-GCM で暗号化**して保存
- 端末の公開鍵（credential）も同じファイルに保存し、増減はアトミック更新
- セッションは **HMAC-SHA256 署名付き cookie**（30日）
- ユーザーごとの学習コンテンツは `data/content/<userId>.json`
  （ホームの「きょうの カード」と来訪回数がユーザーごとに変わります）
- `/` `/flashcards` `/build` `/quiz` はログイン必須。未ログインなら `/login` へ

### 初回セットアップ

```bash
npm run auth:keygen   # 出力された 2 行を .env.local に貼る
npm run dev
```

1. http://localhost:3000/login を開く
2. 「なまえ」「どうぶつ」「保護者パスフレーズ（8文字以上）」を入力
3. 「ゆび/かお を とうろく する」→ 端末の生体認証を実行

2人目以降は「おうちの ひとは こちら」→「あたらしい こどもを ふやす」から
追加します（`GUARDIAN_ADMIN_PASSPHRASE` が必要）。
すでにいる子どもの端末を増やすときは「この たんまつを とうろく」+
その子どもの保護者パスフレーズを使います。

環境変数の一覧は `.env.example` を参照してください。

### 本番で使うときの注意

- `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` は **本番ドメインに固定**してください。
  未設定のあいだはリクエストのホストから推測します（一時トンネル用）。
- **RP ID を変えると、それ以前に登録した生体認証は使えなくなります**
  （再登録が必要）。ドメインが決まる前に本番運用を始めないのが吉。
- `data/` は `.gitignore` 済み。バックアップはこのディレクトリごと取得してください。
- `USERPOOL_MASTER_KEY` を失うと保護者パスフレーズは復号できなくなります。

---

管理: OpenClaw (Steve Lobs) 🤖🎩
