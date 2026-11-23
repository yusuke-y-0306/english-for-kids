import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Card — 面の役割を 3 つに絞る (#120)。
 *
 * raised  … 画面の主役（白い面が浮く）
 * soft    … 補助的なまとまり（クリームの面）
 * outline … 情報の囲み（影を落とさない）
 */
export type CardVariant = "raised" | "soft" | "outline";
export type CardPadding = "none" | "sm" | "md" | "lg";

const VARIANTS: Record<CardVariant, string> = {
  raised: "border-4 border-white bg-surface-raised/85 shadow-card",
  soft: "bg-surface-muted",
  outline: "border-2 border-secondary/15 bg-surface",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-7 sm:p-9",
};

export function Card({
  variant = "raised",
  padding = "md",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  padding?: CardPadding;
}) {
  return (
    <div
      className={cn("rounded-card", VARIANTS[variant], PADDING[padding], className)}
      {...props}
    />
  );
}
