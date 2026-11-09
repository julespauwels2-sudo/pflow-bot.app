import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  // Charte : pill rose en aplat, texte nuit, ombre plate décalée.
  primary: "bg-pink text-nuit shadow-bouton hover:-translate-y-px active:translate-y-px active:shadow-none",
  // Secondaire discret : contour 2 px, texte de la surface (blanc sur le fond nuit, nuit dans une carte blanche).
  secondary: "border-2 border-ink/25 text-ink hover:border-ink/60 hover:bg-ink/5",
  ghost: "text-ink hover:bg-ink/10",
  danger: "border-2 border-alerte text-alerte hover:bg-pink/10",
};

// Pills de la charte : Plus Jakarta 800, majuscules, espacement. Téléphone (max-md) : 44 px de haut au moins.
const buttonBase =
  "inline-flex max-md:min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-extrabold uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

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
    <section className={cx("carte rounded-[var(--radius-card)] p-5 shadow-card sm:p-6", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-2xl text-ink">{title}</h2>}
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
      <span className="text-sm font-bold">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-xs text-alerte">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </label>
  );
}

// Champs toujours blancs à texte nuit (lisibles sur toutes les surfaces), contour 2 px, focus bleu.
const inputBase =
  "w-full rounded-[var(--radius-field)] border-2 border-nuit/15 bg-white px-3 py-2 text-sm text-nuit [color-scheme:light] placeholder:text-nuit/45 focus:border-blue focus:outline-none focus:ring-4 focus:ring-blue/25";

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
// Badges = pills de la charte, en aplat : texte nuit sur reflet, rose ou bleu.
const tones: Record<Tone, string> = {
  neutral: "bg-ink/10 text-ink",
  success: "bg-cyan text-nuit",
  warning: "bg-pink text-nuit",
  info: "bg-blue text-nuit",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-[0.04em] uppercase", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "info", children, onClose }: { tone?: "info" | "error" | "success"; children: ReactNode; onClose?: () => void }) {
  // Aplats de la charte : bleu (info), rose (erreur), reflet (succès) ; texte nuit.
  const styles = {
    info: "aplat-bleu",
    error: "aplat-rose",
    success: "aplat-bleu bg-cyan",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold", styles)}>
      <div>{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="text-ink/70 hover:text-ink" aria-label="Fermer">
          ✕
        </button>
      )}
    </div>
  );
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-muted">Chargement…</p>;
}
