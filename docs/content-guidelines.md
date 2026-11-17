# 語彙コンテンツの作り方 — issue #83

語彙（単語・意味・絵文字・音声パス）は **コードではなく JSON** に置く。
コードは「読む・検証する・引く」だけを持ち、語を足すのに `.ts` を触らなくてよい。

## 置き場所

```
content/vocabulary/<category>.json     # 1 カテゴリ = 1 ファイル
src/lib/vocabulary/load.ts             # スキーマと検証（唯一の正）
src/lib/vocabulary/registry.ts         # ファイル一覧（静的 import）
src/lib/words.ts                       # 互換アダプタ（画面はここを使い続ける）
```

`data/` は学習履歴（ユーザーごとの保存領域）で `.gitignore` 対象なので、
**コンテンツを `data/` に置かない**。

## カテゴリファイル

```json
{
  "id": "animals",
  "label": "動物",
  "emoji": "🐾",
  "color": "from-amber-300 to-orange-400",
  "words": [
    {
      "id": "animals/dog",
      "en": "dog",
      "ja": "いぬ",
      "emoji": "🐶",
      "pos": "noun",
      "level": "pre-a1",
      "audio": null
    }
  ]
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `id`（ファイル） | ✅ | カテゴリ ID。lower-kebab-case（`animals`, `body-parts`） |
| `label` | ✅ | 画面に出す日本語ラベル |
| `emoji` | ✅ | カードの絵文字 |
| `color` | ✅ | カード前面の Tailwind gradient クラス |
| `words` | ✅ | 1 語以上。空配列は不可 |

## 単語

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `id` | ✅ | **不変**の進捗キー。`<category>/<slug>`（例 `animals/dog`）。lower-kebab-case |
| `en` | ✅ | 表示する英単語。**後から直してよい**（`id` は変えない） |
| `ja` | ✅ | 日本語の意味 |
| `emoji` | ✅ | カード／クイズの絵 |
| `pos` | ✅ | 品詞（下記） |
| `level` | ✅ | CEFR（`pre-a1` / `a1` / `a2`） |
| `audio` | ✅ | 音声の public パス。未生成は `null`（キーは省略しない） |
| `image` | – | 画像の public パス。無ければ省略 or `null` |
| `homophones` | – | 同音異綴り（`two` → `["too","to"]`）。発音判定で正解扱い |
| `variants` | – | 意味は同じ別語（`mother` → `["mom"]`）。`close` 止まり |
| `pos` の値 | | `noun` / `verb` / `adjective` / `adverb` / `pronoun` / `determiner` / `numeral` / `preposition` / `conjunction` / `interjection` |

- `audio` / `image` は `null` か **`/` で始まる public パス**（例 `/audio/words/animals/dog.mp3`）。
- `audio` は手で書かない。`npm run audio:generate` が `audioPathForId()` の値で埋める
  （生成・予算・オフラインの詳細は `docs/audio-assets.md`）。
- 未知のフィールドは**エラー**（`levle` のような typo をビルドで止めるため）。
- `homophones` / `variants` は重複不可・空文字不可。

## `id` は不変 — ここが肝

進捗と発音の履歴は `words[id]` / `cards[id]` で保存されている（`docs/progress.md`）。
ID を `en` から組み立てると、**綴りを 1 文字直しただけで学習履歴が切れる**。
そのため:

- `id` は JSON に明記し、`en` とは独立に保つ
- `wordId()` は `word.id` を返すだけ（`en` を見ない）
- `en` を直すときは `id` を据え置く。`id` の変更は「別の語」とみなし、履歴を引き継がない

ID の形は `<category>/<slug>`。slug は表示語と一致している必要はないが、
最初は `en` と同じにしておくと読みやすい。

## 追加・変更の手順

1. `content/vocabulary/<category>.json` を編集（新カテゴリならファイルを追加）
2. 新カテゴリのときは `src/lib/vocabulary/registry.ts` に **import と sources の 1 行**を足す
3. 検証する

```bash
npm run vocabulary:check   # スキーマ検証（CI と同じ）
npm run test:unit          # ID 不変・重複・欠落のテスト
npm run build              # 実際の読み込み経路で検証
```

`registry.ts` への追加漏れは `tests/unit/vocabulary.test.mjs` が
（ディレクトリと参照の一致で）検出する。

## 検証されること

`src/lib/vocabulary/load.ts` の `buildCategories()` が次を検査し、
1 つでも違反があれば **ファイル名と位置付きで throw** する。
`next build` / `next dev` はこの module を評価するので、壊れた JSON では画面が出ない。

- 必須項目の欠落、型違い、空文字
- 未知フィールド（typo）
- `id` の形式違反、カテゴリ ID と接頭辞の不一致（= 未知カテゴリ）
- `id` の重複（カテゴリ・単語の両方）
- `pos` / `level` が列挙値以外
- `audio` / `image` が `null` でも `/` 始まりでもない
- `homophones` / `variants` の重複・空文字

## 未着手（この基盤の上に載せる）

- 音声アセットの生成と `audio` の埋め込み
- 画像アセット（`image`）
- 語彙の拡張 / サイトワード / フォニックス
- `pos` / `level` の割り当ては初期値。ネイティブレビューで調整する
