/**
 * class 名の合成 — 依存を増やさないための最小ヘルパー。
 *
 * 条件付きの class を `false` / `null` / `undefined` で書けるようにするだけ。
 * `clsx` や `tailwind-merge` は入れない（重複解決が必要になったら、そのときに
 * 理由を書いてから足す）。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
