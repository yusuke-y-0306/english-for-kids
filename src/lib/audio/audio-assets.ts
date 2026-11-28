/**
 * 単語音声アセットの置き場所と予算 — issue #84
 *
 * 純粋な定数とパス計算だけを置く (DOM も fs も触らない)。クライアント
 * (再生)、生成スクリプト、CI の検査、テストが **同じ規則** を共有するため。
 */

/** 音声を置くディレクトリ (public からのパス) */
export const WORD_AUDIO_DIRECTORY = "/audio/words";

/** オフライン用の一覧 (Service Worker が install 時に precache する) */
export const WORD_AUDIO_INDEX = "/audio/words/index.json";

/**
 * 1 語あたりの上限。edge-tts の既定 (24kHz / 48kbps モノラル) だと
 * 1 語 8〜15KB に収まるので、40KB は「壊れた/長すぎるファイル」の検出線。
 */
export const MAX_WORD_AUDIO_BYTES = 40 * 1024;

/**
 * 全語ぶんの合計上限。
 *
 * #87 で 200 語 (実測 ~2.1MB) になり 3MB。#88 でフォニックスの 144 語
 * (26 フォニーム + 78 代表語 + 40 CVC) が増えて 344 語・実測 ~3.6MB なので
 * 5MB に引き上げた。語彙を増やすときは、この上限と `docs/audio-assets.md` を
 * 一緒に見直す (カテゴリ単位の先読みは #100)。
 */
export const MAX_TOTAL_WORD_AUDIO_BYTES = 5 * 1024 * 1024;

/** 単語 ID の形 (`<category>/<slug>`)。ID は content 側で検証済み */
const WORD_ID = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

/**
 * 単語 ID → 音声ファイルの public パス。
 *
 * `/audio/words/animals/dog.mp3` のようにカテゴリで 1 階層掘る。
 * `id` は不変 (#83) なので、このパスも学習履歴と同じ寿命で安定する。
 */
export function audioPathForId(id: string): string {
  if (!WORD_ID.test(id)) {
    throw new Error(`invalid word id for audio: "${id}"`);
  }
  return `${WORD_AUDIO_DIRECTORY}/${id}.mp3`;
}

/** 単語 ID → リポジトリ内の実ファイルパス (`public` を含む) */
export function audioFileForId(id: string): string {
  return `public${audioPathForId(id)}`;
}
