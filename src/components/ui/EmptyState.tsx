import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * EmptyState — 「まだ何もない」を責めず、次の一歩を 1 つだけ置く (#120)。
 *
 * 破線の枠は使わない。子どもには「壊れている」に見えるため。
 */
export function EmptyState({
  title,
  description,
  action,
  art,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border-4 border-white bg-surface-raised/85 p-6 text-center shadow-card",
        className,
      )}
    >
      {art && <div className="mb-3 flex justify-center">{art}</div>}
      <p className="text-kid-body font-extrabold text-ink">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-kid-label font-bold text-ink-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
