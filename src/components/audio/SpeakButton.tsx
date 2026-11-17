"use client";

import { playWordAudio, type PlayableWord } from "@/lib/audio/play";
import { useAudioMuted } from "@/lib/audio/use-audio-muted";

type Props = {
  word: PlayableWord;
  /** ボタンの文言。既定は「きく」 */
  label?: string;
  className?: string;
  /** `ghost` は白地、`primary` は水色 (発音練習のお手本など) */
  tone?: "ghost" | "primary";
  size?: "sm" | "md";
};

/**
 * 単語の読み上げボタン (カード / クイズ / 発音のお手本で共通) — issue #84
 *
 * ミュート中は押せない (押しても無音だと「壊れてる」と思われるため)。
 * 解除は同じ画面の `MuteToggle` で行う。
 */
export function SpeakButton({ word, label = "きく", className = "", tone = "ghost", size = "md" }: Props) {
  const muted = useAudioMuted();

  const look =
    tone === "primary"
      ? "bg-[#4dc9f6] text-white shadow-[0_3px_0_rgba(26,111,149,0.35)]"
      : "border-2 border-[#c98b5e] bg-white text-[#5b4a3c] shadow-[0_3px_0_rgba(122,104,87,0.16)]";
  const padding = size === "sm" ? "px-3.5 py-2 text-xs" : "px-5 py-2.5 text-sm";

  return (
    <button
      type="button"
      onClick={() => void playWordAudio(word)}
      disabled={muted}
      aria-label={`「${word.en}」の はつおんを きく`}
      title={muted ? "おとが オフに なっています" : `「${word.en}」を きく`}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full font-extrabold transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${look} ${padding} ${className}`}
    >
      <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
      {muted ? "おと オフ" : label}
    </button>
  );
}
