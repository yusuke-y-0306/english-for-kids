/**
 * 「きいてるよ…」のまま固まらないための見張り — issue #2
 *
 * 画面は `listen()` を呼んだ瞬間に「きいてるよ…」へ切り替えるが、認識側の
 * 準備 (モデルの読み込み / マイクの許可 / worklet の取得) が返ってこないと、
 * 子どもには **押しても何も起きないボタン** に見えてしまう。
 *
 * 認識側の各段階には個別のタイムアウトを入れてある (`wasm-recognition.ts`)。
 * それでも端末によっては想定外の止まり方をするので、画面側にも最終の番人を置く。
 * ここは判定だけを持つ純粋な部分 (unit テストで固定する)。
 */

/** 画面が「きいてるよ…」を維持してよい上限 (ms)。超えたら必ず聞き直しを促す */
export const LISTEN_WATCHDOG_MS = 30_000;

/**
 * 聞き取り開始から `limit` を過ぎたか。
 * 時計が巻き戻った (負の経過) 場合は「固まっていない」とみなす。
 */
export function isListenStuck(
  startedAt: number,
  now: number,
  limit: number = LISTEN_WATCHDOG_MS,
): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return false;
  const elapsed = now - startedAt;
  return elapsed >= limit;
}
