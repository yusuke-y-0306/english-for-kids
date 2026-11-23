import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * SectionHeading — 見出しの強さを 1 か所に固定する (#120)。
 *
 * 画面ごとに `text-lg` / `text-2xl` / `text-[1.85rem]` を書き分けない。
 * eyebrow は 12px 以上。10px の大文字ラベルは作らない。
 */
export function SectionHeading({
  title,
  description,
  eyebrow,
  align = "left",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      {eyebrow && (
        <p className="text-kid-caption font-extrabold tracking-[0.12em] text-secondary">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-1 text-kid-title font-extrabold text-ink">{title}</h2>
      {description && (
        <p className="mt-2 max-w-2xl text-kid-body font-bold text-ink-muted">{description}</p>
      )}
    </div>
  );
}
