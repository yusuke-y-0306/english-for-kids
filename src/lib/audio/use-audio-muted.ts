"use client";

import { useSyncExternalStore } from "react";

import { isMuted, subscribeMuted } from "./settings";

/**
 * 「おと OFF」かどうか。SSR では常に false (サーバに localStorage は無い)。
 * ハイドレーション後に実際の値へ揃う。
 */
export function useAudioMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, () => false);
}
