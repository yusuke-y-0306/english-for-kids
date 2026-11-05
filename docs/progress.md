# 進捗管理のデータ設計 — issue #4

学習履歴（いつ・どれだけ・何ができたか）の保存方針。実装は
`src/lib/progress/` にあり、この文書は **何を保存し、何を保存しないか** の合意事項。

## 保存するもの / しないもの

保存する（`data/content/<uid>.json` の `data.progress`）:

| キー | 内容 |
|---|---|
| `days["YYYY-MM-DD"]` | その日の `quiz.rounds / correct / total` と `pronunciation.attempts / ok` |
| `words[wordId]` | 単語ごとの `correct / wrong / lastAt`（クイズのみ） |
| `longestStreak` | 最長の連続学習日数（#69 が更新） |
| `lastStudyAt` / `updatedAt` | ISO 8601 |

**保存しないもの**:

- 音声・認識されたテキスト（#32 の方針を継承。保存しないものは漏れない）
- 端末名・IP・User-Agent（セッション側の役割）
- 自由記述のメモ

## 場所

- 1 ユーザー = 1 ファイル: `data/content/<uid>.json`（`src/lib/auth/content.ts`）
- 既存の発音ストア `data.pronunciation` と同じ名前空間を使い、キーで機能を分ける
- `data/` は **リポジトリに含めない**（`.gitignore` 済み）。デプロイで消えないよう、
  `deploy.yml` は `git reset --hard` + `.next` 削除だけで、`data/` には触らない
- 読み書きは必ず `getUserContent()` / `updateUserContent()` 経由（tmp + rename のアトミック更新）

## 日付は JST

- 「きょう学習した」は `src/lib/progress/day.ts` の `dayKeyOf()`（Asia/Tokyo）で判定する
- `new Date().toISOString().slice(0, 10)` は **使わない**。UTC なので日本では 09:00 までが前日になる
- `src/lib/daily.ts` の `todayInTokyo` はこの関数の再エクスポート（実装を 2 つ持たない）

## 保持期間

- 日次: **直近 400 日**（`PROGRESS_RETENTION_DAYS`）。超えた古い日は保存時に落とす
- 単語: `words.ts` の語数で自然に上限が決まる
- グラフ（7 日）や月次レビューには十分で、ファイルサイズも数十 KB に収まる

## 同時更新

- `src/lib/store/lock.ts` の `withUserLock(userId, ...)` で **ユーザー単位に直列化**
- 進捗（#4）と発音（#32）は同じファイルを書くので、ロックを共有している
- 単一プロセス前提（PM2 等で多重化するならファイルロックが必要。今の構成では 1 プロセス）

## 壊れたデータの扱い

`normalizeProgressState()` が **落ちない** ことを最優先にしている。

- 未知のキー・型違い・負の数は捨てる / 0 に丸める
- `correct > total`、`ok > attempts` は上限に丸める（表示が 120% にならない）
- 日付キーの形が違うものは無視する
- 例外を投げないので、壊れたファイルでも進捗ページは「空」として開ける

## バックアップ

- `data/` を丸ごとコピーすれば復元できる（`users.json` と `content/*.json`）
- 復元時は `data/content/<uid>.json` の `data.progress` だけ差し替えてもよい（他キーは残す）
- 進捗は「あったら嬉しい」データなので、失っても学習そのものは壊れない設計にしておく

## 未実装（別 issue）

- 記録 API: #65（クイズ）/ #66（発音の取り込み）
- 集計と取得 API: #67
- 画面: #68（進捗ページ）/ #69（ストリーク表示）/ #70（保護者向け）
