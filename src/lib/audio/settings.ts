/**
 * アプリ全体の「おと ON / OFF」— issue #84
 *
 * クイズの効果音 (#3) と単語の読み上げ (#84) は同じ設定を見る。
 * localStorage を外部ストアとして扱い、`useSyncExternalStore` から読める形にする
 * (`storage` イベントで別タブの変更にも追従する)。
 */

const MUTED_KEY = "kodomo-eigo-audio-muted-v1";

/** クイズ単体で持っていた古いキー。設定を引き継ぐためだけに読む */
const LEGACY_QUIZ_MUTE_KEY = "kodomo-eigo-quiz-mute-v1";

const CHANGE_EVENT = "kodomo-eigo-audio-changed";

let cached: boolean | null = null;

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  if (cached !== null) return cached;

  let muted = false;
  try {
    const stored = window.localStorage.getItem(MUTED_KEY);
    muted =
      stored === null
        ? window.localStorage.getItem(LEGACY_QUIZ_MUTE_KEY) === "1"
        : stored === "1";
  } catch {
    /* 壊れた/使えない localStorage でも おとは ならせる */
    muted = false;
  }
  cached = muted;
  return cached;
}

export function setMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  cached = muted;
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    /* 保存できなくても その場の設定は効かせる */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 反転して新しい値を返す */
export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

/** `useSyncExternalStore` 用。別タブの変更も拾う */
export function subscribeMuted(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    cached = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
