import type { ButtonHTMLAttributes, ReactNode } from "react";

/* Small shared pieces. Colours come from the semantic tokens in index.css,
 * which flip with prefers-color-scheme, so nothing here writes dark:. */

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function ColumnHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold tracking-wider text-fg-3 uppercase">{children}</h2>;
}

type Tone = "neutral" | "accent" | "warn" | "err";
const TONES: Record<Tone, string> = {
  neutral: "bg-raised text-fg-2",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  err: "bg-err-soft text-err",
};

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center rounded px-1.5 whitespace-nowrap py-0.5 text-[11px] leading-none font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border-transparent",
  secondary: "bg-panel text-fg border-line-strong hover:bg-raised",
  ghost: "bg-transparent text-fg-2 border-transparent hover:bg-raised hover:text-fg",
};

export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none";
