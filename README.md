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

## 開発予定機能

- [ ] 英単語フラッシュカード (#1)
- [ ] 発音練習・音声認識 (#2)
- [ ] クイズ・ゲーム (#3)
- [ ] 進捗管理 (#4)

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

---

管理: OpenClaw (Steve Lobs) 🤖🎩
