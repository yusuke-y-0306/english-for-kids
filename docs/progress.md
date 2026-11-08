# 進捗管理のデータ設計 — issue #4

学習履歴（いつ・どれだけ・何ができたか）の保存方針。実装は
`src/lib/progress/` にあり、この文書は **何を保存し、何を保存しないか** の合意事項。

## 保存するもの / しないもの

保存する（`data/content/<uid>.json` の `data.progress`）:

| キー | 内容 |
|---|---|
| `days["YYYY-MM-DD"]` | その日の `quiz.rounds / correct / total` と `pronunciation.attempts / ok` |
| `words[wordId]` | 単語ごとの `correct / wrong / lastAt`（クイズのみ） |
| `quizRoundIds` | 直近に記録したクイズの `roundId`（冪等キー。新しい順・最大 32 件） |
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

## 冪等性 — 同じラウンドを 2 回数えない（#65）

クイズの結果は `POST /api/progress/quiz` に送る。この API は `roundId`
（クライアントが作る UUID）を**冪等キー**として受け取り、同じ ID の 2 回目以降は
**何も足さずに 200 を返す**（`duplicate: true`）。

- リロード / 二重タップ / オフライン復帰後の再送で、がんばった子ほど数字が水増しされるのを防ぐ
- 覚えるのは **新しい順に最大 `QUIZ_ROUND_MEMORY`（32）件**。1 件だけだと
  「2 ラウンド前の再送」を弾けない。32 件 ≈ 256 問ぶんで実用上は十分
- 記憶から溢れた古い ID はもう弾けない（**覚えていないものは弾けない**）。これは
  仕様として受け入れる。水増しの窓を閉じるのが目的で、完全な履歴を持つことではない
- 同じ状態が返ってきたとき（＝加算なし）は**ファイルに書かない**。
  `updatedAt` だけが動く空振り書き込みを避ける

`words[wordId]` は「単語に紐づく問題」だけを数える。中級・上級の文法問題は
単語を持たないので `wordId: null` で送り、日次の `rounds / correct / total` にだけ
反映する（単語別の得意・不得意を文法問題で汚さない）。

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

- 記録 API: #66（発音の取り込み）※ クイズは #65 で実装済み
- 集計と取得 API: #67
- 画面: #68（進捗ページ）/ #69（ストリーク表示）/ #70（保護者向け）
