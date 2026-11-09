"use client";

/**
 * Contenu d'un message dans la boîte de réception, comme dans WhatsApp (téléphone et ordinateur) :
 * - texte avec la mise en forme WhatsApp (*gras*, _italique_, ~barré~) ;
 * - boutons de réponse sous le texte, séparés, avec leur libellé exact ;
 * - bouton lien : libellé + icône de lien ; l'adresse n'apparaît pas en clair (au survol, ou appui long sur
 *   téléphone, c'est un vrai lien) ;
 * - liste : le bouton de la liste, qui déplie ses options.
 * La réponse du client à un bouton est enregistrée avec le libellé du bouton : elle s'affiche comme sa bulle.
 */
import type { ReactNode } from "react";
import { waSegments } from "@/lib/inbox-view";

type Option = { id?: string; title?: string; description?: string };
type Content =
  | { kind: "buttons"; text?: string; buttons?: Option[] }
  | { kind: "link"; text?: string; url?: string; buttonLabel?: string }
  | { kind: "list"; text?: string; buttonLabel?: string; items?: Option[] };

/** Le message structuré du bot (boutons, lien, liste), ou null pour un texte simple. */
export function interactiveContent(contenu: unknown): Content | null {
  const c = (contenu ?? {}) as { kind?: unknown };
  if (c.kind === "buttons" || c.kind === "link" || c.kind === "list") return c as Content;
  return null;
}

export function Formatted({ text }: { text: string }) {
  return (
    <>
      {waSegments(text).map((seg, i) =>
        seg.style === "bold" ? <strong key={i}>{seg.text}</strong> : seg.style === "italic" ? <em key={i}>{seg.text}</em> : seg.style === "strike" ? <s key={i}>{seg.text}</s> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

const linkIcon = (
  <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const listIcon = (
  <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/** Ligne de bouton sous la bulle, sur toute sa largeur (comme WhatsApp). */
const row = "flex min-h-10 w-full items-center justify-center gap-1.5 border-t border-navy/10 px-3 py-2 text-center font-semibold text-[#027eb5]";

/**
 * `texte` : texte lisible du message (repli pour les anciens messages) ; `contenu` : le message enregistré ;
 * `footer` : l'heure, placée sous le texte et au-dessus des boutons.
 */
export function MessageContent({ texte, contenu, footer }: { texte: string; contenu: unknown; footer?: ReactNode }) {
  const c = interactiveContent(contenu);
  if (!c) {
    return (
      <>
        <Formatted text={texte} />
        {footer}
      </>
    );
  }
  return (
    <div data-testid={`message-${c.kind}`}>
      {c.text && <Formatted text={c.text} />}
      {footer}
      <div className="-mx-3 mt-1.5 -mb-1.5 whitespace-normal">
        {c.kind === "buttons" &&
          (c.buttons ?? []).map((b, i) => (
            <span key={b.id ?? i} className={row} data-testid="message-bouton">
              {b.title}
            </span>
          ))}
        {c.kind === "link" && (
          <a href={c.url} target="_blank" rel="noopener noreferrer" title={c.url} className={`${row} hover:bg-navy/5`} data-testid="message-lien">
            {linkIcon}
            {c.buttonLabel}
          </a>
        )}
        {c.kind === "list" && (
          <details className="group">
            <summary className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-testid="message-liste">
              {listIcon}
              {c.buttonLabel}
            </summary>
            <ul className="border-t border-navy/10 px-3 py-1 text-sm">
              {(c.items ?? []).map((item, i) => (
                <li key={item.id ?? i} className="py-1">
                  <span className="block font-semibold">{item.title}</span>
                  {item.description && <span className="block text-xs text-muted">{item.description}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
