import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-bouton hover:brightness-105 active:translate-y-px",
  secondary: "bg-white text-navy border border-line shadow-card hover:border-navy/25",
  ghost: "text-navy hover:bg-navy/5",
  danger: "bg-white text-coral border border-coral/40 hover:bg-coral/10",
};

// Téléphone (max-md) : 44 px de haut au moins, pour le doigt. Ordinateur : inchangé.
const buttonBase =
  "inline-flex max-md:min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function ButtonLink({ href, variant = "primary", className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(buttonBase, variants[variant], className)}>
      {children}
    </Link>
  );
}

/** Bouton qui ouvre un sélecteur de fichier. */
export function FileButton({ accept, onFile, children, variant = "secondary" }: { accept: string; onFile: (file: File) => void; children: ReactNode; variant?: Variant }) {
  return (
    <label className={cx(buttonBase, variants[variant], "cursor-pointer")}>
      {children}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[var(--radius-card)] border border-rule bg-white p-5 shadow-card sm:p-6", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="text-sm font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-xs text-coral">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </label>
  );
}

const inputBase =
  "w-full rounded-[var(--radius-field)] border border-line bg-white px-3 py-2 text-sm text-navy placeholder:text-muted/60 focus:border-pink focus:outline-none focus:ring-4 focus:ring-pink/15";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputBase, "min-h-20", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputBase, "pr-8", className)} {...props} />;
}

type Tone = "neutral" | "success" | "warning" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-navy/5 text-muted",
  success: "bg-wa/15 text-green-700",
  warning: "bg-pink/10 text-pink",
  info: "bg-blue/10 text-blue",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "info", children, onClose }: { tone?: "info" | "error" | "success"; children: ReactNode; onClose?: () => void }) {
  const styles = {
    info: "border-blue/30 bg-blue/5",
    error: "border-coral/40 bg-coral/10",
    success: "border-wa/40 bg-wa/10",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm", styles)}>
      <div>{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="text-muted hover:text-navy" aria-label="Fermer">
          ✕
        </button>
      )}
    </div>
  );
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-muted">Chargement…</p>;
}
