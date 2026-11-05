/**
 * ユーザーごとの直列化 (排他ロック)
 *
 * `updateUserContent()` は read-modify-write なので、同じ子が連打すると
 * 更新が取りこぼされる。単一プロセスで動く前提の簡易ロックで直列化する
 * (再起動で消えるが、失われるのは同時実行時の競合だけ)。
 *
 * ロックのキーは **ユーザー ID**。進捗 (#4) と発音 (#32) は同じ
 * `data/content/<uid>.json` を書くので、キーを共有して直列化する必要がある。
 * そのためどちらのストアもこのモジュールを通す。
 */

const locks = new Map<string, Promise<void>>();

export async function withUserLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  const guard = current.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, guard);
  try {
    return await current;
  } finally {
    // 自分が最後の番なら後片付けする (Map が無限に増えないように)
    if (locks.get(key) === guard) locks.delete(key);
  }
}
