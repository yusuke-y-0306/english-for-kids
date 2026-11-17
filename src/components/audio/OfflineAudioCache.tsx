"use client";

import { useEffect } from "react";

/**
 * 単語音声の Service Worker を登録する — issue #84
 *
 * 登録するのは **本番ビルドだけ**。開発中は SW が残ると「直したのに古い音が鳴る」
 * のような混乱を生むので入れない (`/sw.js` 自体は public にある)。
 *
 * キャッシュ対象は `/audio/` だけ (public/sw.js を参照)。API や画面には触らない。
 */
export function OfflineAudioCache() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* 登録できなくても再生は通常の HTTP で動く */
      });
    };

    if (document.readyState === "complete") {
      register();
      return () => {
        cancelled = true;
      };
    }

    window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
