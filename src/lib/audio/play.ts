/**
 * 単語の読み上げ再生 — issue #84
 *
 * 方針:
 *  - **生成済みの音声を優先** (`/audio/words/...`)。声・速さが端末で変わらない
 *  - 未生成 / 再生失敗のときだけ **端末 TTS** にフォールバック (無音にしない)
 *  - **多重再生しない**: モジュールで 1 個の `Audio` を使い回し、新しい要求が来たら
 *    前の再生を止める。連打しても音が重ならない
 *  - ミュート設定 (#84 の共有ストア) が ON なら何も鳴らさない
 */

import { isMuted } from "./settings";

export type PlayableWord = {
  id: string;
  en: string;
  audio?: string | null;
};

export type PlayOutcome =
  /** 生成済みの音声を再生した */
  | "played"
  /** 端末 TTS で読んだ */
  | "fallback"
  /** ミュート中なので何もしなかった */
  | "muted"
  /** ブラウザが再生を許さなかった / 音声 API が無い */
  | "blocked";

let player: HTMLAudioElement | null = null;

/** 再生要求の世代。古い `play()` の失敗でフォールバックしないために使う */
let generation = 0;

function stopPlayer(): void {
  if (!player) return;
  try {
    player.pause();
    player.currentTime = 0;
  } catch {
    /* 停止できなくても致命的ではない */
  }
}

function speakWithDevice(word: PlayableWord): PlayOutcome {
  if (typeof window === "undefined") return "blocked";
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return "blocked";

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(word.en);
  utterance.lang = "en-US";
  /* 子ども向けに少しゆっくり。端末差はあるが、フォールバックなので許容する */
  utterance.rate = 0.85;
  synth.speak(utterance);
  return "fallback";
}

/** いま鳴っているものを止める (画面移動時などに使う) */
export function stopWordAudio(): void {
  if (typeof window === "undefined") return;
  generation += 1;
  stopPlayer();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* 端末が speechSynthesis を持たないだけ */
  }
}

/**
 * 単語を 1 回読む。連打されたら **最後の 1 回だけ**が鳴る。
 *
 * `await` して結果を UI に使ってもよいが、呼び出し側は基本 fire-and-forget。
 */
export async function playWordAudio(word: PlayableWord): Promise<PlayOutcome> {
  if (typeof window === "undefined") return "blocked";
  if (isMuted()) {
    stopWordAudio();
    return "muted";
  }

  stopWordAudio();
  const mine = ++generation;

  if (!word.audio) return speakWithDevice(word);

  try {
    if (!player) {
      player = new Audio();
      player.preload = "auto";
    }
    player.src = word.audio;
    player.currentTime = 0;
    await player.play();
    return "played";
  } catch {
    /* 生成済みファイルが 404 / デコード不能 / 自動再生ブロック。
       新しい要求に追い越されていたら、そちらの邪魔をしない。 */
    if (mine !== generation) return "blocked";
    stopPlayer();
    return speakWithDevice(word);
  }
}
