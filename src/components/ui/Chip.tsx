import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Chip — カテゴリやフィルタの 1 個 (#120)。
 *
 * `aria-pressed` を自分で付けるので、呼び出し側は `selected` を渡すだけでよい。
 * 44px を下回らない。選択中は濃い茶 + 白文字でコントラストを確保する。
 */
export function Chip({
  selected = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-chip border-2 px-4 py-2 text-kid-label font-extrabold transition",
        selected
          ? "border-transparent bg-secondary text-white shadow-[0_3px_0_var(--color-secondary-shadow)]"
          : "border-white bg-surface-raised text-ink shadow-button hover:-translate-y-0.5 hover:bg-surface-muted",
        className,
      )}
      {...props}
    >
      {children}
      {selected && (
        <span aria-hidden className="ml-1 text-[0.9em] leading-none">
          ✓
        </span>
      )}
    </button>
  );
}
