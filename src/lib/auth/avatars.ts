/**
 * ユーザー (子ども) のアバター候補。
 * 文字入力なしで選べるように、絵文字 + テーマ色のセットで提供する。
 */

export type AvatarChoice = {
  emoji: string;
  color: string;
  label: string;
};

export const AVATARS: AvatarChoice[] = [
  { emoji: "🐰", color: "#ff8fb0", label: "うさぎ" },
  { emoji: "🐻", color: "#c98b5e", label: "くま" },
  { emoji: "🐱", color: "#ffc94d", label: "ねこ" },
  { emoji: "🐨", color: "#8fb8d6", label: "こあら" },
  { emoji: "🦊", color: "#ff9f45", label: "きつね" },
  { emoji: "🐼", color: "#9aa5b1", label: "ぱんだ" },
  { emoji: "🐸", color: "#8fd06a", label: "かえる" },
  { emoji: "🐧", color: "#4dc9f6", label: "ぺんぎん" },
  { emoji: "🦁", color: "#e8b520", label: "らいおん" },
  { emoji: "🐮", color: "#a17bf0", label: "うし" },
  { emoji: "🐷", color: "#f58fb0", label: "ぶた" },
  { emoji: "🐙", color: "#ff6b6b", label: "たこ" },
];

export const DEFAULT_AVATAR: AvatarChoice = AVATARS[0];

export function findAvatar(emoji: string | undefined): AvatarChoice {
  return AVATARS.find((a) => a.emoji === emoji) ?? DEFAULT_AVATAR;
}
