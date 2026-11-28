import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Button / LinkButton — 画面ごとに手で書いていた CTA を 1 か所に集める (#120)。
 *
 * 使い分けは 3 つだけ:
 *  - primary   … その画面で「これだけは押してほしい」1 つ
 *  - secondary … 別の道（メニューへ戻る、やりなおす）
 *  - ghost     … 文字だけの補助操作
 *
 * 色・角丸・影は globals.css のトークン経由。ここに hex を書かない。
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-button font-extrabold transition " +
  "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-ink shadow-primary hover:-translate-y-0.5 " +
    "active:translate-y-1 active:shadow-none",
  secondary:
    "border-[3px] border-secondary/25 bg-surface-raised text-secondary shadow-button " +
    "hover:-translate-y-0.5 hover:border-secondary/40 active:translate-y-1 active:shadow-none",
  ghost: "text-ink hover:bg-surface-muted",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-kid-label",
  lg: "min-h-14 px-7 text-kid-body",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

type StyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  loading = false,
  children,
  ...props
}: StyleProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** 通信中など。押せないことと「いま処理中」を同時に伝える */
    loading?: boolean;
  }) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type LinkButtonProps = StyleProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
    href: string;
    className?: string;
    disabled?: boolean;
  };

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  disabled = false,
  children,
  href,
  ...props
}: LinkButtonProps) {
  if (disabled) {
    return (
      <span
        className={cn(buttonClasses({ variant, size, className }), "pointer-events-none opacity-45")}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={buttonClasses({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
