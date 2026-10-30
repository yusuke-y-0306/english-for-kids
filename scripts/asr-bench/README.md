# 音声認識の計測 (issue #40)

発音練習の認識経路は `device`(ブラウザの端末内認識) → `wasm`(Moonshine) → `self-report` の順で選ぶ。
この順序は「Google の端末内モデルのほうが子ども・騒音に強い」という**見立て**で決めている。
ここでやるのは、その見立てを**実測で裏づける (か、ひっくり返す)** こと。

3 ステップ (ブラウザ不要・Node だけで回る):

1. 実機で収録する (ブラウザだけ。音声は端末から出ない)
2. 収録した音声を Moonshine に通す (ローカル)
3. アプリと同じ採点ロジックで表にする

## 1. 収録する

実機で開く:

```
https://<本番URL>/lab/asr-bench/
```

- 単語が 1 語ずつ出るので、「この単語を とる」を押して 4 秒しゃべる。12 語で 1 セット。
- 「端末内認識も いっしょに ためす」にチェックが入っていると、同じ発話を端末内認識にも通す
  (同時に走らせるので、1 回しゃべるだけで両方の結果が取れる)。チェックは
  `available() === "available"` のときだけ自動で入る。
- **テスト用 Chromium (Playwright 同梱) ではチェックを外す**。
  あの Chromium には on-device speech サービスが無く、`available()` を呼ぶとレンダラが落ちる。
- 終わったら「結果を JSON で保存」。`asr-bench-<日時>.json` が Downloads に入る。

音声が外に出ない根拠: ページは `fetch` を 1 回 (`words.json`) するだけで、
CSP の `connect-src` も `'self'` だけ。送信先が無い。

## 2. Moonshine に通す

```bash
npm i --no-save @moonshine-ai/moonshine-wasm
npm run models:fetch            # モデルのキャッシュが無いときだけ
node scripts/asr-bench/moonshine.mjs ~/Downloads/asr-bench-*.json -o bench.moonshine.json
```

- モデルは **`models-cache/` から読む**。CDN (`download.moonshine.ai`) は使わない
  (アプリ本番と同じ「自前のモデルだけ」という方針に揃える)。別の場所は `--model-dir`。
- 推論は Node 上の WASM。ブラウザを立ち上げないので、CI でも回せる。
  量子化は q8 / モデルは `TinyStreaming` が既定 (`--arch BaseStreaming` も可)。

## 3. 表にする

```bash
node scripts/asr-bench/report.mjs bench.moonshine.json
```

出るもの:

- 単語ごとの 認識テキスト / 判定 (🎉 ok・😊 close・🔁 retry) / 推論時間
- エンジンごとの集計と平均レイテンシ
- **判定が割れた単語**と **retry になった単語** (誤検出の候補)

判定はアプリ本体の `scorePronunciation()` をそのまま import している。
計測用に採点を書き直すと、本番と違う基準で比べることになるので**やらない**。

## 読み方 (ここが肝心)

- **retry の数**が最重要。子どもが正しく言えているのに「もういちど」と出るのが一番まずい。
  Moonshine の retry が device より明らかに多いなら、既定の優先順位 (device 優先) は正しい。
- **割れた単語**を見る。device が ok で Moonshine が retry なら、WASM は「子どもの声に弱い」証拠。
  逆なら Moonshine のほうが拾えている。
- **レイテンシ**は判定の質ではない。`wasm` は初回にモデルのロードが乗るので `loadMs` も見る。
- 「同一音声での比較」ではない。録音と端末内認識は同時に走らせているが、
  認識側の前処理 (AEC / NS) はブラウザ任せ。差が小さいときは「同等」と読むのが安全。
- 12 語 × 1 人では統計にならない。**判断を変えるのは差がはっきりしているときだけ**にする。
  語数を増やすときは `scripts/asr-bench/words.mjs` の `LIMIT` を上げる。

## 分かっていないこと

- `transcribe()` / `Stream` の出力に**単語ごとの `confidence` が入らなかった** (0.1.5 + 現行の
  モデルキャッシュ)。`WordTiming.confidence` は型にはあるので、追加のモデルファイル
  (`decoder_with_attention.ort` など) かオプションが要る可能性がある。#40 で確認する。
  取れないと「どの単語が怪しいか」のフィードバックは作れないので、そこは設計に影響する。
- Node とブラウザで**同じ数字になる保証はない** (スレッド数・SIMD の有無)。
  この計測で比べてよいのは**精度と傾向**で、レイテンシは参考値。

## 単語リストの更新

`public/lab/asr-bench/words.json` は `src/lib/words.ts` から生成している。単語を変えたら:

```bash
npm run bench:asr:words
```
