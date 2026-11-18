# 単語の読み上げ音声 — issue #84

単語の音声は **事前生成してリポジトリに置く**。端末の TTS に任せると、声・速さ・
そもそも鳴るかどうかが端末ごとに変わる。子ども向けアプリでは「いつも同じ声」が
学習の前提になるので、生成物を `public/` に持たせて配る。

## 置き場所と対応

| 何 | どこ |
| --- | --- |
| 音声 | `public/audio/words/<category>/<slug>.mp3`（例 `public/audio/words/animals/dog.mp3`） |
| 公開パス | `/audio/words/animals/dog.mp3` |
| 単語との紐付け | `content/vocabulary/*.json` の `audio`（生成スクリプトが埋める） |
| オフライン用の一覧 | `public/audio/words/index.json` |
| パス計算と予算 | `src/lib/audio/audio-assets.ts` |

`audio` は **単語 ID から機械的に決まる**（`audioPathForId()`）。`id` は不変 (#83)
なので、綴りを直しても音声のパスと学習履歴は動かない。

## 予算

| 対象 | 上限 | 実測 (2026-11) |
| --- | --- | --- |
| 1 語 | 40KB | 最大 11.7KB（`sports/basketball`） |
| 全 160 語 | 2MB | 1756.1KB |

上限は「壊れたファイル・長すぎるファイル」の検出線として `audio:check` が見る。
音質より **短さと明瞭さ** を優先する（1 語 1 秒未満）。

## 生成

声は `en-US-JennyNeural`（女性・friendly）を `-10%` の速さで。端末に依存させないため、
生成は開発機で 1 回だけ行い、mp3 をコミットする。**CI では生成しない**（ネットワーク不要）。

準備（初回だけ）:

```bash
pip install edge-tts        # Python 3.9+
# 環境によっては: python3 -m pip install --user edge-tts
# pip が externally-managed と言う場合: pip install --target ~/.local/lib/edge-tts edge-tts
#   → PYTHONPATH=~/.local/lib/edge-tts を付けて実行
```

生成:

```bash
npm run audio:generate              # 足りない単語だけ生成
npm run audio:generate -- --force   # 全部作り直す
npm run audio:generate -- --dry-run # 何が足りないかだけ表示 (exit 1)
npm run audio:generate -- --voice=en-US-AnaNeural --rate=-20%
```

スクリプトがやること:

1. `content/vocabulary/*.json` を読む
2. 未生成（`audio` が null / ファイルが無い）の単語だけ edge-tts で mp3 を作る
3. JSON の `audio` を `/audio/words/<category>/<slug>.mp3` で埋める
4. `public/audio/words/index.json` を書き出す（content の並び順）
5. 1 語の予算を超えたら警告

生成後は **mp3・JSON・index.json の 3 つをコミットする**。

## 検査（CI）

```bash
npm run audio:check
```

- 全単語の `audio` が `audioPathForId(id)` と一致する
- ファイルがあり、空でなく、40KB 以内
- MP3 として読める先頭バイト（ID3 かフレーム同期）
- `index.json` が content と完全一致（欠落・余剰・件数）
- 合計 2MB 以内（#86 で 160 語になったため 1MB から引き上げ）

CI (`ci.yml`) の lint 段で実行する。音声はコミット済みなのでネットワークには出ない。

## 再生（画面側）

| 何 | どこ |
| --- | --- |
| 再生 | `src/lib/audio/play.ts` |
| ON/OFF の保存 | `src/lib/audio/settings.ts`（localStorage `kodomo-eigo-audio-muted-v1`） |
| ボタン | `src/components/audio/SpeakButton.tsx` |
| ON/OFF ボタン | `src/components/audio/MuteToggle.tsx` |

- **生成済み音声を優先**し、`audio` が null か再生に失敗したときだけ端末 TTS
  (`speechSynthesis`, `en-US`, rate 0.85) にフォールバックする
- **多重再生しない**: `Audio` 要素は 1 個だけ使い回し、新しい要求が来たら前を止める
  （連打しても音が重ならない）
- ミュートはアプリ共通。クイズの効果音も同じ設定を見る（旧 `kodomo-eigo-quiz-mute-v1`
  からは自動で引き継ぐ）
- ミュート中は `SpeakButton` を押せない（無音を「壊れてる」と誤解させないため）

再生位置: フラッシュカード（カード下）、クイズ（正解発表後に「もういちど きく」）、
発音練習（お手本）。

## オフライン（PWA キャッシュ）

`public/sw.js` + `src/components/audio/OfflineAudioCache.tsx`。

- Service Worker は **本番ビルドでのみ登録**（開発中は登録しない）
- `install` で `index.json` の音声をまとめて precache（失敗しても install は続行）
- `fetch` は **`/audio/` だけ** を横取りする。キャッシュ優先 + 裏で更新
  (stale-while-revalidate)。それ以外のリクエストには一切触らない
- アプリ本体（HTML/JS）のオフライン化はこの SW の担当外

注意: 同じファイル名で音声を作り直した場合、手元のブラウザには古い音が残る
（裏の更新は次回再生から）。すぐ確認したいときは DevTools → Application →
Service Workers で Unregister する。

## いつ音声がダウンロードされるか

音声は **HTML / JS のバンドルには含めない**（`public/` の静的ファイルとして別に配る）。
実際に通信が起きるのは次のタイミング。

| タイミング | 何が起きるか |
| --- | --- |
| ページ表示（本番・初回） | `load` の後に SW を登録し、`install` で `index.json` の 160 語（約 1.8MB）を **裏でまとめて** 取得する。画面の表示は待たせない |
| 再生（SW あり） | Cache Storage から即時に鳴る。ネットワークには出ない（オフラインでも可） |
| 再生（SW なし = 開発中 / install 完了前） | その単語の mp3（約 8〜12KB）を **クリック時に初回取得**。以後は `Cache-Control: public, max-age=0` + ETag なので再確認のリクエストが飛ぶ（多くは 304） |
| 取得も再生も失敗 | 端末 TTS (`speechSynthesis`) にフォールバック |

つまり「**初回に 1.8MB を先に読む ⇔ 以後の再生は 0 バイト**」のトレードオフを選んでいる。
データ通信を最小にしたい場合は、`public/sw.js` の `install` にある precache を外し、
「鳴らした語だけキャッシュする」（`fetch` 時の `cache.put` だけ残す）に変えればよい。
その場合、一度も鳴らしていない語はオフラインでは端末 TTS になる。

先読みは **6 本ずつ** 流し、`navigator.connection.saveData` が有効な端末と
2G 回線では最初から行わない（その場合も再生時の取得は動く）。

## 語彙が増えたとき（1000 語規模の見積り）

実測値（2026-11）からの比例計算:

| 対象 | 160 語（現在） | 1000 語 |
| --- | --- | --- |
| 音声 | 1.8MB（11KB/語） | 約 11MB |
| 語彙 JSON（content） | 37KB（233B/語） | 約 233KB |
| `index.json` | 5.4KB（34B/語） | 約 34KB |

**画面の表示は遅くならない。** 音声は HTML/JS のバンドル外で、`load` の後に
SW が裏で取りに行くため、初回描画を待たせない。再生の待ち時間も 1 語ずつなので変わらない。

遅くなる（＝つらくなる）のは次の 3 点:

1. **初回のバックグラウンド通信**: 11MB / 1000 リクエスト。10Mbps で約 9 秒、
   1Mbps で約 90 秒ぶんの通信を `load` 後に始める。画面は出るが、回線が細いと
   他の通信（次のページの取得など）を圧迫する
2. **クライアント JS の語彙データ**: いま `words.ts` 経由で全カテゴリの JSON が
   クライアントバンドルに入る。1000 語で raw 約 233KB（gzip で 70KB 前後）増える。
   音声より先にこちらが効いてくるので、語彙が増えるなら **カテゴリ単位で分割**し、
   表示中のカテゴリだけを渡す（サーバコンポーネントから props で渡す / 動的 import）
3. **リポジトリ容量**: mp3 11MB。数年ぶんの更新を考えると、将来は音声だけ
   別ホスティング（GitHub Pages / オブジェクトストレージ）へ逃がす選択肢もある

推奨の伸ばし方: **カテゴリ単位の先読み**（子どもが「動物」を開いたら動物の 8 語 =
約 90KB だけ取る）。オフラインで鳴らせる範囲は「開いたことのあるカテゴリ」に
限定されるが、初回の通信は 1/50 以下になり、体感はほぼ変わらない。

## 声について

`edge-tts` は Microsoft のオンライン TTS を CLI から使う非公式クライアント。
生成時にだけテキスト（英単語）を送り、実行時には何も送らない。再配布・商用利用の
条件は Microsoft 側の規約を確認すること（気になる場合は piper などの完全ローカル
TTS に差し替えられる。差し替え先は `scripts/generate-audio.mjs` の `synthesize()` だけ）。
