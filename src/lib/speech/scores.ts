/**
 * 発音判定のスコア定義 — issue #2 / #32
 *
 * クライアント (判定 UI) とサーバ (保存 API) の両方が使うので、
 * **純粋な定数と型だけ**をここに置く (node:fs などを巻き込まない)。
 */

export const PRONUNCIATION_SCORES = ["ok", "close", "retry"] as const;

export type PronunciationScore = (typeof PRONUNCIATION_SCORES)[number];

export function isPronunciationScore(value: unknown): value is PronunciationScore {
  return typeof value === "string" && (PRONUNCIATION_SCORES as readonly string[]).includes(value);
}
