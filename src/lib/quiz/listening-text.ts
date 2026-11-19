/**
 * リスニングクイズの「文字」表示 — issue #85
 *
 * リスニングは「音 → 絵」で解くモードなので、既定では文字を **小さく添える**
 * だけにして、設定で完全に隠せるようにする（読めない子の邪魔をしない）。
 *
 * 設定はアプリ共通の `audio/settings.ts` と同じ流儀で localStorage に置き、
 * `useSyncExternalStore` から読む（SSR では常に既定値）。
 */

const TEXT_KEY = "kodomo-eigo-listening-text-v1";
const CHANGE_EVENT = "kodomo-eigo-listening-text-changed";

/** 既定は「見せる」。隠したい人は設定で消す（保護者が操作する想定） */
const DEFAULT_VISIBLE = true;

let cached: boolean | null = null;

export function isListeningTextVisible(): boolean {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  if (cached !== null) return cached;

  try {
    const stored = window.localStorage.getItem(TEXT_KEY);
    cached = stored === null ? DEFAULT_VISIBLE : stored === "1";
  } catch {
    /* localStorage が使えなくても 既定値で動く */
    cached = DEFAULT_VISIBLE;
  }
  return cached;
}

export function setListeningTextVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  cached = visible;
  try {
    window.localStorage.setItem(TEXT_KEY, visible ? "1" : "0");
  } catch {
    /* 保存できなくても その場の設定は効かせる */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 反転して新しい値を返す（ボタン用） */
export function toggleListeningTextVisible(): boolean {
  const next = !isListeningTextVisible();
  setListeningTextVisible(next);
  return next;
}

/** `useSyncExternalStore` 用。別タブの変更も拾う */
export function subscribeListeningText(onChange: () => void): () => void {
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
