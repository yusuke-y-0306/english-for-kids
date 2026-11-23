import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * StatTile — 数字を 1 つだけ大きく見せる (#120)。
 *
 * 進捗画面のように数字が並ぶ場所で、ラベルと値を同じ強さで書かないための部品。
 * 値は 24px 以上。ラベルは 12px 以上。
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "neutral" | "success" | "primary";
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success-soft text-success"
      : tone === "primary"
        ? "bg-surface-muted text-secondary"
        : "bg-surface-raised text-ink";

  return (
    <div
      className={cn(
        "rounded-card border-4 border-white p-4 shadow-card",
        toneClass,
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon && <span aria-hidden>{icon}</span>}
        <span className="text-kid-caption font-extrabold">{label}</span>
      </div>
      <p className="mt-1 text-2xl leading-none font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-kid-caption font-bold opacity-80">{hint}</p>}
    </div>
  );
}
