# 進捗管理のデータ設計 — issue #4

学習履歴（いつ・どれだけ・何ができたか）の保存方針。実装は
`src/lib/progress/` にあり、この文書は **何を保存し、何を保存しないか** の合意事項。

## 保存するもの / しないもの

保存する（`data/content/<uid>.json` の `data.progress`）:

| キー | 内容 |
|---|---|
| `days["YYYY-MM-DD"]` | その日の `quiz.rounds / correct / total`、`pronunciation.attempts / ok`、`cards.views` |
| `words[wordId]` | 単語ごとの `correct / wrong / lastAt`（クイズの正誤 + 移行時の発音シード。下記 #66） |
| `cards[wordId]` | 単語ごとの `views / lastAt`（カードで意味を見た回数。クイズの正誤とは別勘定） |
| `quizRoundIds` | 直近に記録したクイズの `roundId`（冪等キー。新しい順・最大 32 件） |
| `cardEventIds` | 直近に記録したカード閲覧の `eventId`（冪等キー。新しい順・最大 64 件） |
| `longestStreak` | 最長の連続学習日数（#69 が更新） |
| `lastStudyAt` / `updatedAt` | ISO 8601 |
| `migratedFromPronunciation` | 既存の発音ストアから単語別の種を蒔いた印（#66。`true` のときだけ存在） |

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

## カードの記録 — 見たことと正解を混ぜない（#76）

フラッシュカードで **意味を見た瞬間**（おもて → うら）に
`POST /api/progress/cards` へ `{ eventId, wordId }` を送る。

- `eventId`（クライアントが作る UUID）が **冪等キー**。同じ ID の再送は数えない
- 覚えるのは **新しい順に最大 `CARD_EVENT_MEMORY`（64）件**
- 日次の `cards.views` と、単語別の `cards[wordId].views` を 1 ずつ増やす
- **`words[wordId]` には触らない**。カードを見ただけで「正解した」ことにすると、
  習得度（クイズ 3 回正解で「おぼえた」）が水増しされるため
- 集計では `cards[wordId].views > 0` を「れんしゅうちゅう」の根拠にだけ使う
  （「おぼえた」にはしない）
- 同じページ表示中はクライアント側でも単語ごとに 1 回だけ送る。失敗したら印を戻し、
  次のめくりで再挑戦する（遊びは止めない）

## 同時更新

- `src/lib/store/lock.ts` の `withUserLock(userId, ...)` で **ユーザー単位に直列化**
- 進捗（#4）と発音（#32）は同じファイルを書くので、ロックを共有している
- 単一プロセス前提（PM2 等で多重化するならファイルロックが必要。今の構成では 1 プロセス）

## 発音の取り込み — 同じ試行を 2 回数えない（#66）

発音練習（#32）の結果は `data.pronunciation` に単語 ID・スコア・回数として入っている。
進捗ページで「発音もがんばった」を見せるため、その **日次だけ** を
`data.progress.days[...].pronunciation` にも載せる（`ok` のときだけ `ok` に数える）。

肝は **1 回の書き込みで両方を更新する** こと。

- `recordPronunciationAttempt()` は `withUserLock()` の中で 1 回だけ
  `getUserContent()` し、`pronunciation` と `progress` を **まとめて**
  `updateUserContent()` に渡す（tmp + rename は 1 回）
- 2 回書くと「発音は増えたが日次は増えていない」中途半端な状態が生まれる。
  その窓を作らないために、進捗ストア側の `recordPronunciationDay()` は **置いていない**
  （あとから呼べる道を残すと、いつか二重書き込みが復活する）

同じ事実を 2 か所で数えないための分担:

| 数字 | 正となる場所 |
|---|---|
| 発音の累計回数 | `pronunciation.totalAttempts` |
| 発音の日次（きょう何回） | `progress.days[...].pronunciation` |
| 発音の単語別（回数・直近スコア） | `pronunciation.byWord` |

集計（#67）はこの 3 つを混ぜない。「累計」と「日次合計」が一致するのは
**移行後に入力された試行だけ**（下記の理由で過去の日次は復元できない）。

### 既存ユーザーの移行（1 回きり）

機能を入れる前から発音をやっていた子は `data.pronunciation` しか持っていない。
`words[]` が空のままだと「単語別の手応え」が消えて見えるので、
**発音の記録時に一度だけ** `byWord` から `correct / wrong` を蒔く
（`seedWordsFromPronunciation()`）。その後 `migratedFromPronunciation: true` を立て、
2 回目以降は何もしない（再デプロイで数字が増えない）。

移行の限界（仕様として受け入れる）:

- **日次は遡及できない**。`byWord` は「回数」と「直近のスコア」しか持たないため、
  過去の「いつ・何回」は復元しない（移行後の試行から数え始める）
- `correct / wrong` は近似。直近が `ok` なら全回を正解、それ以外は全回を不正解として蒔く
- **クイズで既に数えている単語は触らない**（`words[wordId]` が既にあればスキップ）。
  発音の回数を足すと、同じ単語を 2 つの事実で二重に数えることになる
- 種まきは発音の記録が入口。発音を一度も記録せずクイズだけ遊んだ子は、
  種まきの機会が無い（`words[]` はクイズの実績だけになる）

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

- 記録 API: クイズは #65、発音の取り込み（日次への反映と移行）は #66、
  カードの記録は #76 で実装済み
- 集計と取得 API: #67 で実装済み（下記）
- 画面: #68（進捗ページ）/ #69（ホームのストリークバッジ。判定ロジックは #67 で実装済み）
  / #70（保護者向け）

## 集計と取得 — `GET /api/progress`（#67）

画面（#68）と保護者向け（#70）が使う **読み取り口**。数字の作り方は
`src/lib/progress/summary.ts` と `src/lib/progress/streak.ts` の純粋関数だけで、
Route Handler は組み立てるだけ。

### リクエスト

| パラメータ | 動き |
|---|---|
| `days` | 直近何日ぶんの系列を返すか。**1〜90 にクランプ**（既定 7）。`0` / `-5` は 1、`91` / `1000` は 90、`abc` は既定の 7 |

- 不正値は **400 にしない**（URL をいじっただけで画面がエラーになる方が不親切）
- `uid` / `userId` は **クエリでもボディでも受け付けない**。ユーザーはセッションからだけ決める
- `cache-control: no-store`（個人の学習履歴を CDN / ブラウザに残さない）

### レスポンス

```jsonc
{
  "ok": true,
  "today": "2026-11-09",                  // JST
  "days": [                               // 古い順・必ず days 件（歯抜けは 0 で埋める）
    { "day": "2026-11-03",
      "quiz": { "rounds": 0, "correct": 0, "total": 0, "accuracy": 0 },
      "pronunciation": { "attempts": 0, "ok": 0 },
      "studied": false }
  ],
  "streak": { "current": 2, "longest": 5, "studiedToday": true, "lastStudyDay": "2026-11-09" },
  "words": { "animals/dog": { "id": "animals/dog", "level": "mastered", "correct": 3,
                              "wrong": 0, "pronunciation": { "attempts": 0, "ok": false },
                              "lastAt": "..." } },
  "categories": [ { "id": "animals", "label": "動物", "emoji": "🐾",
                    "total": 8, "mastered": 1, "learning": 1, "unseen": 6 } ],
  "pronunciation": { "totalAttempts": 3, "lastAttemptAt": "..." }
}
```

- `days[].quiz.accuracy` は **0〜100 の整数 %**（出題 0 なら 0）。`correct > total` は total に丸める
- `words` は **手を付けた単語だけ**（`words.ts` の並び順）。全 48 語を毎回返すと payload が膨らむため
- `categories` は **未学習でも全カテゴリ返す**（画面が「まだ 0 / 8」を出せるように）
- `pronunciation.totalAttempts` は **累計の正**（発音ストア側）。日次合計とは一致しない
  （移行前の日次は遡及していないため。#66 参照）

### 習得度のしきい値

`MASTERY_THRESHOLDS`（`summary.ts`）に **1 か所だけ** 置く。

| レベル | 条件 |
|---|---|
| `mastered`（おぼえた） | クイズで 3 回正解、またはクイズ 1 回正解 + 発音 `ok` |
| `learning`（れんしゅうちゅう） | クイズの正誤がある、または発音を試した |
| `unseen`（まだ） | 記録が無い |

### 連続日数（ストリーク）の仕様

`streakOf(days, today)`（`streak.ts`）:

- 日付は **JST**。`today` は呼び出し側が `dayKeyOf()` で渡す（関数内で `new Date()` を呼ばない）
- **今日まだでも、昨日まで続いていれば `current` は維持**。`studiedToday: false` で「きょうも やろう」を出す
- 2 日以上空いたら `current = 0`
- 未来の日付キーは **無視**（端末の時計が進んでいても壊れない）
- 「学習した日」= クイズ 1 ラウンド以上 **または** 発音 1 回以上（画面を開いただけでは数えない）
- `longest` は日次から数え直した値。API は保存値 `longestStreak` との **大きい方** を返す
  （保存値は保持期間 400 日より前の記録を持っていることがある）

### 依存の向き（なぜ引数で受け取るのか）

`summary.ts` / `streak.ts` は **import を 1 つも持たない**（`state.ts` / `day.ts` と同じ流儀）。
純粋関数を `node --test` の型ストリッピングで直接 import するため、単語一覧とカテゴリは
Route Handler が `words.ts` から渡す。日付キーの加減算だけは `addDays()` と同じ計算を
各ファイルに 4 行だけ持つ（`import` すると解決できないため。計算内容は `day.ts` が正）。

## 画面 — `/progress`（#68）

ホームの「進捗管理」カードから入る画面。上から順に:

1. **ストリークのバッジ** — 🔥 n 日れんぞく。「今日やった」「今日まだ（でも続いている）」
   「途切れた」を文言で区別する（`studiedToday` を見る）
2. **きょうの できた** — クイズのラウンド数・正答率・発音の回数、累計の発音回数
3. **直近 7 日の棒グラフ** — **SVG を自前で描く**（外部ライブラリなし・`viewBox` で伸縮）
4. **カテゴリ別 できた かず** — おぼえた（緑）/ れんしゅうちゅう（黄）の帯
5. **ことばの ようす** — `<details>` による折りたたみ。**JS を使わない**ので CSP の
   nonce 経路に乗せる必要がない（inline script を増やさない）

### 数字は API と同じ 1 本の経路

画面は `loadProgressSnapshot()`（`snapshot.ts`）を通す。これは `GET /api/progress` と
**同じ関数**なので、SSR の表示と JSON が食い違わない。画面はクライアント fetch を
挟まない（数字がちらつかない）。

### 空状態

まだ何も記録が無い子には、グラフやカテゴリを出さず **責めない文言＋あそびへの導線**
（クイズ / カード）を出す。0 の棒だけの画面にしない。

### 幅

360px で横スクロールが出ないこと（`scrollWidth === clientWidth`）を確認済み。
固定幅を置かず、`w-full` と SVG の `viewBox` スケールに任せている。
スクリーンショットは `docs/screenshots/progress-{375,360}.png` と
`progress-empty-360.png`。
