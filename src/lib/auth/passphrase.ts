/**
 * 保護者パスフレーズ / 管理者パスフレーズの「入力ゆれ」を吸収する。
 *
 * 家庭の端末は iPhone / iPad が中心で、次のような「見えない違い」で
 * 正しいパスフレーズが弾かれる。子ども向けアプリでこれは致命的なので、
 * 保存時と照合時の両方で同じ正規化を通す。
 *
 *   - コピペや予測変換で前後に付く空白・改行
 *   - 日本語 IME が混ぜる全角英数 (ａｂｃ → abc, NFKC)
 *   - ゼロ幅スペース・BOM・ソフトハイフンなどの不可視文字
 *   - iOS のスマート句読点が変えるハイフン (– — → -)
 *
 * 内側の空白は「その人のパスフレーズの一部」なので潰さない。
 */
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const SMART_HYPHENS = /[\u2010-\u2015\u2212]/g;

export function normalizePassphrase(input: string): string {
  return input
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SMART_HYPHENS, "-")
    .trim();
}
