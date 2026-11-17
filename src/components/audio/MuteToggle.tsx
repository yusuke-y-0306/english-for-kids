"use client";

import { toggleMuted } from "@/lib/audio/settings";
import { useAudioMuted } from "@/lib/audio/use-audio-muted";

type Props = {
  className?: string;
  /** アイコンだけでなく「おと ON / OFF」の文字も出す */
  withLabel?: boolean;
};

/**
 * おとの ON / OFF 切り替え — issue #84
 *
 * 設定は localStorage に保存され、カード・クイズ・発音練習の全部に効く
 * (クイズの効果音も同じ設定を見る)。
 */
export function MuteToggle({ className = "", withLabel = false }: Props) {
  const muted = useAudioMuted();

  return (
    <button
      type="button"
      onClick={() => void toggleMuted()}
      aria-pressed={muted}
      aria-label={muted ? "おとを だす" : "おとを けす"}
      title={muted ? "おとを だす" : "おとを けす"}
      className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full ${
        withLabel ? "px-3" : "w-9"
      } bg-white text-base shadow-[0_2px_0_rgba(122,104,87,0.16)] transition hover:-translate-y-0.5 ${className}`}
    >
      <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
      {withLabel && (
        <span className="text-xs font-extrabold text-[#5b4a3c]">
          {muted ? "おと オフ" : "おと オン"}
        </span>
      )}
    </button>
  );
}
