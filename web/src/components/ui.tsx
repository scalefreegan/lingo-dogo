import type { ButtonHTMLAttributes, ReactNode } from "react";

/* Small shared pieces. Colours come from the semantic tokens in index.css,
 * which flip with prefers-color-scheme, so nothing here writes dark:.
 *
 * Fine print (badges, meta lines, small buttons) is 14px on a phone and
 * only drops to 11–12px from `sm` up: `text-sm sm:text-xs` throughout, so
 * nothing on a phone renders below 14px. Tap heights come from the
 * base-layer rule in index.css, not from classes here. */

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 ${className}`} {...rest}>
      {children}
    </section>
  );
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
    <span title={title} className={`inline-flex shrink-0 items-center rounded px-1.5 whitespace-nowrap py-0.5 text-sm leading-none font-medium sm:text-[11px] ${TONES[tone]}`}>
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

/** The folder picker the Go tab's save form and a Library row's "Move to" share. */
export function FolderSelect({
  value,
  folders,
  disabled,
  label,
  onChange,
}: {
  value: string;
  folders: string[];
  disabled?: boolean;
  label: string;
  onChange: (folder: string) => void;
}) {
  return (
    <select aria-label={label} className={`${inputClass} w-auto`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">No folder</option>
      {folders.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}

/** A chevron that rotates open — the Customize tab's row disclosure. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`size-4 shrink-0 text-fg-3 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
