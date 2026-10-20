/**
 * 文法チェックの型定義
 *
 * `GrammarPattern` は「文の骨組み（テンプレート）」を表す。
 * 例: ["<subject>", "<be>", "<mood>", "thank", "you"]
 *   - `<...>` はスロット（穴）。`slots` にその穴に入れられる語/語句を書く。
 *   - それ以外はリテラル（そのままの語）。大文字小文字は無視して比較する。
 */

/** スロットに入る語。単語の配列、または語句（複数トークン）の配列。 */
export type SlotValues = string[] | string[][];

export type GrammarPattern = {
  /** パターンの識別子（デバッグ・テスト用） */
  id: string;
  /** 文の骨組み。`<slot>` かリテラル */
  tokens: string[];
  /** スロット名 → 入れてよい語/語句 */
  slots: Record<string, SlotValues>;
};

/** 文法ルール違反の内容 */
export type GrammarIssue = {
  rule: "agreement" | "article";
  /** 子供に見せるやさしい日本語 */
  message: string;
};

/** `GrammarChecker.check` の結果 */
export type GrammarResult =
  | { ok: true; patternId: string }
  | { ok: false; issue: GrammarIssue | null };
