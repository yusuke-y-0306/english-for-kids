/**
 * 保護者パスフレーズの総当たり対策 (プロセス内メモリの簡易レート制限)。
 * 単一プロセスで動く前提。再起動でリセットされるが、家庭内利用では十分。
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

type Bucket = { failures: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function get(key: string): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  if (bucket.resetAt < Date.now()) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

/** これ以上試させない状態か */
export function isLocked(key: string): boolean {
  const bucket = get(key);
  return !!bucket && bucket.failures >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  const bucket = get(key);
  if (bucket) {
    bucket.failures += 1;
    return;
  }
  buckets.set(key, { failures: 1, resetAt: Date.now() + WINDOW_MS });
  // 念のため肥大化を防ぐ
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.resetAt < Date.now()) buckets.delete(k);
    }
  }
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function lockMessage(): string {
  return "まちがいが おおいので、しばらく まってから もういちど おねがいします";
}
