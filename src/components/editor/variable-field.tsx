"use client";

import { useEffect, useRef, useState } from "react";
import { insertVariable, type VariableInfo } from "@/editor/variables";

interface Props {
  value: string;
  onChange: (value: string) => void;
  variables: VariableInfo[];
  multiline?: boolean;
  placeholder?: string;
  /** Affiche un compteur « 12 / 20 » et passe en rouge au-delà. */
  max?: number;
  ariaLabel?: string;
}

const base =
  "w-full rounded-xl border border-line carte px-3 py-2 pr-12 text-sm text-ink placeholder:text-muted/60 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20";

/** Champ texte avec un menu pour insérer une variable {{...}} au curseur. */
export function VariableField({ value, onChange, variables, multiline, placeholder, max, ariaLabel }: Props) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const count = [...value].length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function insert(name: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const result = insertVariable(value, name, start, end);
    onChange(result.text);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.cursor, result.cursor);
    });
  }

  const common = {
    ref,
    value,
    placeholder,
    "aria-label": ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      // « {{ » ouvre le menu des variables.
      if (e.key === "{" && value.slice(0, ref.current?.selectionStart ?? 0).endsWith("{")) {
        e.preventDefault();
        const el = ref.current!;
        const start = (el.selectionStart ?? 1) - 1;
        onChange(value.slice(0, start) + value.slice(el.selectionEnd ?? start + 1));
        requestAnimationFrame(() => el.setSelectionRange(start, start));
        setOpen(true);
      }
    },
  };

  return (
    <div className="relative" ref={menuRef}>
      {multiline ? <textarea {...common} rows={3} className={`${base} min-h-20 resize-y`} /> : <input {...common} className={base} />}
      <button
        type="button"
        title="Insérer une variable (ou tapez {{)"
        aria-label="Insérer une variable"
        onClick={() => setOpen((o) => !o)}
        className="absolute top-1.5 right-1.5 rounded-lg bg-pink/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-rose hover:bg-pink/20"
      >
        {"{x}"}
      </button>
      {max !== undefined && (
        <p className={`mt-0.5 text-right text-[11px] ${count > max ? "font-semibold text-alerte" : "text-muted"}`}>
          {count} / {max}
        </p>
      )}
      {open && (
        <div role="menu" className="absolute top-9 right-0 z-20 w-64 overflow-hidden rounded-xl border border-line carte shadow-pop">
          <p className="border-b border-rule px-3 py-2 text-xs font-semibold text-muted">Insérer une variable</p>
          {variables.map((v) => (
            <button
              key={v.name}
              role="menuitem"
              type="button"
              onClick={() => insert(v.name)}
              className="block w-full px-3 py-2 text-left hover:bg-ink/5"
            >
              <span className="font-mono text-xs font-semibold text-rose">{`{{${v.name}}}`}</span>
              <span className="block text-xs text-muted">{v.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
