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
| 1 語 | 40KB | 最大 11.4KB（`family/grandfather`） |
| 全 48 語 | 1MB | 526.9KB |

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
- 合計 1MB 以内

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

## 声について

`edge-tts` は Microsoft のオンライン TTS を CLI から使う非公式クライアント。
生成時にだけテキスト（英単語）を送り、実行時には何も送らない。再配布・商用利用の
条件は Microsoft 側の規約を確認すること（気になる場合は piper などの完全ローカル
TTS に差し替えられる。差し替え先は `scripts/generate-audio.mjs` の `synthesize()` だけ）。
