/**
 * セッションが「まだ有効か」の判定 — 即時失効 (issue #52)
 *
 * 署名付き cookie はステートレスなので、発行済みのセッションを後から殺せない。
 * そこでユーザー側 (users.json) に世代番号を持たせ、cookie にも発行時の世代を
 * 載せておく。世代が上がっていれば、その cookie は **その瞬間に** 無効になる。
 *
 *  - `tokenVersion` … ユーザー全体の世代。上げると全端末がログアウト
 *  - `devices[].version` … 端末ごとの世代。上げるとその端末だけログアウト
 *
 * この関数は **依存を持たない** (型だけの世界)。`pool.ts` を import すると
 * `node --test` の型ストリッピングで相対 import が解決できず単体テストが書けない。
 * そのため構造的部分型で受ける。
 */

export type SessionFreshnessInput = {
  /** cookie に入っているユーザーの世代 */
  readonly tv?: number;
  /** cookie に入っている端末の世代 */
  readonly dv?: number;
  /** cookie に入っている端末の指紋 (UA ハッシュ) */
  readonly ua?: string;
};

export type UserFreshnessInput = {
  readonly tokenVersion?: number;
  readonly devices?: ReadonlyArray<{ readonly ua: string; readonly version: number }>;
};

/** 失効している理由。`null` なら有効 */
export type RevocationReason =
  /** ユーザーの世代が上がっている (全端末ログアウト) */
  | "token-version"
  /** 端末の世代が上がっている (その端末だけログアウト) */
  | "device-version"
  /** 端末の記録が消えている (覚えの無い端末) */
  | "unknown-device"
  /** 世代を持たない古い cookie (移行前に発行されたもの) */
  | "no-version";

export function checkSessionFreshness(
  session: SessionFreshnessInput,
  user: UserFreshnessInput,
): RevocationReason | null {
  /* 世代を持たない cookie は失効できない = 放っておくと永遠に有効なので通さない。
     デプロイ時に一度だけ全員ログインし直しになるが、その代わり「殺せない cookie」を
     作らない。 */
  if (typeof session.tv !== "number") return "no-version";

  const currentTokenVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  if (session.tv !== currentTokenVersion) return "token-version";

  /* 端末の指紋が載っているセッションだけ端末世代を見る
     (指紋が無い cookie は #53 の移行パスで再発行される) */
  if (typeof session.ua === "string" && session.ua !== "") {
    const device = (user.devices ?? []).find((d) => d.ua === session.ua);
    if (!device) return "unknown-device";
    if (typeof session.dv !== "number" || session.dv !== device.version) return "device-version";
  }

  return null;
}
