# UI システム — トークンと部品 (#120)

最終更新: 2026-11-23

## なぜ作るのか

UI 監査で、見た目の貧弱さの原因は「ページごとに手で塗っていること」だった。

- `shadow-[…]` が **60 種類**、角丸が **6 種類**、CTA の色が **5 種類**
- 6 桁 hex の直書きが大量（`#5b4a3c` 66 回、`#8f7a5e` 29 回…）
- 10px の大文字英字ラベルが各所に散らばり、テンプレート感を出している

機能ではなく **語彙（トークン）と部品（コンポーネント）** を揃える。アートの方向性は
**A: 自作 SVG「Buddy & Friends」で統一**（競合分析は PR #115）。

## トークン（`src/app/globals.css` の `@theme`）

### 色 — 役割で選ぶ

| トークン | 値 | 用途 |
| --- | --- | --- |
| `surface` | `#fffdf8` | 画面の下地 |
| `surface-raised` | `#ffffff` | 浮いた面（カード） |
| `surface-muted` | `#fff6e3` | 補助のまとまり |
| `ink` | `#3d3229` | 本文・見出し |
| `ink-muted` | `#6b5a49` | 補助文（4.5:1 を満たす） |
| `primary` | `#f4801f` | その画面の主役 |
| `primary-ink` | `#3d3229` | primary 上の文字（白は 2.64:1 で不足） |
| `primary-shadow` | `#c25f0d` | primary の押し出し |
| `secondary` | `#7a4a2c` | 別の道・選択中 |
| `success` | `#357026` | 正解・できた（淡色の上でも 5.4:1） |
| `danger` | `#b03a63` | まちがい・取り消し |
| `focus` | `#1f6feb` | キーボードの現在地 |

> `primary` の上は **白ではなく `primary-ink`（濃い茶）**。白はコントラスト 2.64:1 で
> 4.5:1 に届かない。子ども向けでも読みやすさを犠牲にしない。

### 角丸 — 3 段だけ

| トークン | 値 | 用途 |
| --- | --- | --- |
| `radius-card` | 24px | カード・シート |
| `radius-button` | 999px | ボタン |
| `radius-chip` | 999px | チップ |

### 影 — 3 段だけ

| トークン | 用途 |
| --- | --- |
| `shadow-card` | 面が浮く |
| `shadow-button` | ボタンの押し出し（primary は `shadow-primary`） |
| `shadow-float` | モーダル・シート |

### 文字 — 子どもが読める大きさ

| トークン | サイズ / 行間 | 用途 |
| --- | --- | --- |
| `text-kid-caption` | 12px / 1.5 | キャプション（これ未満は禁止） |
| `text-kid-label` | 14px / 1.5 | 補助ラベル・ボタン |
| `text-kid-body` | 17px / 1.75 | 本文 |
| `text-kid-title` | 28px / 1.3 | 画面の見出し |
| `text-kid-hero` | 44px / 1.15 | ヒーロー |

## 部品（`src/components/ui/`）

### Button / LinkButton

```tsx
<Button>はじめる</Button>
<Button variant="secondary" size="lg">メニューを みる</Button>
<Button variant="ghost">あとで</Button>
<Button disabled>押せない</Button>
<Button loading>保存中</Button>
<LinkButton href="/quiz">クイズへ</LinkButton>
```

- `variant`: `primary` / `secondary` / `ghost`
- `size`: `md`（44px）/ `lg`（56px）
- `primary` は **1 画面に 1 つ**。同じ強さの CTA を並べない
- リンクは `LinkButton`（`<a>` に button の見た目を付ける）

### Card

```tsx
<Card>...</Card>
<Card variant="soft" padding="lg">...</Card>
<Card variant="outline" padding="none">...</Card>
```

- `variant`: `raised` / `soft` / `outline`
- `padding`: `none` / `sm` / `md` / `lg`

### Chip

```tsx
<Chip selected>動物</Chip>
<Chip>たべもの</Chip>
```

- `selected` で `aria-pressed` が付く
- 44px を下回らない。選択中は `bg-secondary text-white`

### StatTile

```tsx
<StatTile label="れんぞく" value="5 日" tone="primary" />
```

- 値は 24px 以上。ラベルと値を同じ強さで書かない
- `tone`: `neutral` / `success` / `primary`

### SectionHeading / EmptyState

- 見出しのサイズを画面ごとに書かない
- 空状態は破線を使わない（子どもには「壊れている」に見える）

## ルール（レビューで見る）

1. 影は 3 段、角丸は 3 段。新しい値を作らない
2. 色はトークン経由。hex の直書きをしない
3. タップ領域は 44px 以上
4. hover だけで状態を伝えない。`:focus-visible` を必ず出す
5. 10px の大文字ラベルを作らない
6. 破線の枠を「準備中」に使わない
7. `prefers-reduced-motion` で動きを止める
8. 文字のコントラストは 4.5:1 以上（大きい文字は 3:1）

## カタログ

```bash
npm run dev
# http://localhost:3000/dev/ui
```

開発専用（本番は 404）。variant / size / disabled / loading をここで確認してから
画面に組み込む。

## 移行の順番

1. #120 トークンと部品（この文書）
2. #121 ホーム
3. #122 フラッシュカード
4. #123 クイズ
5. #124 Buddy と統一イラスト
6. #125 進捗
7. #126 アクセシビリティとビジュアル回帰

既存画面は一度に作り直さない。**部品 → 1 画面 → 回帰テスト** の順で、常に動く状態を保つ。
