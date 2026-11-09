"use client";

/**
 * Boîte de réception sur téléphone (< 768 px), inspirée de WhatsApp :
 * - liste en plein écran : nom, extrait, heure, « 🔔 Attend l'équipe » bien visible, non lus en gras ; celles qui
 *   attendent Jules en haut ;
 * - conversation en plein écran, flèche retour, bulles lisibles, défilement jusqu'au dernier message, zone de
 *   réponse collée en bas et calée au-dessus du clavier iOS (visual viewport), boutons « Reprendre la main » /
 *   « Rendre au bot » de 44 px.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import type { StoredMessage } from "@/channels/core/types";
import { isUnread, lastAt, plainExtract, shortTime, sortConversations, type SeenState } from "@/lib/inbox-view";
import { MessageContent } from "./message-content";
import { useVisualViewport } from "./mobile";
import { PushControls } from "./pwa";
import { Notice } from "./ui";

export type Thread = { messages: (StoredMessage & { texte: string })[] };

const who = (canal: InboxCanal, conv: InboxConversation) => conv.nom || (canal.plateforme === "instagram" ? `Instagram ${conv.waId.slice(-4)}` : `+${conv.waId}`);
const initials = (name: string) =>
  name
    .replace(/^\+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function pauseLabel(conv: InboxConversation): string | null {
  if (!conv.pause) return null;
  return { transfert_humain: "Bot en pause : transfert", echo_gerant: "Bot en pause : le gérant a répondu", manuel: "Bot en pause : tu as la main" }[conv.pause.reason];
}

export function MobileInboxList({
  canaux,
  seen,
  notice,
  onCloseNotice,
  onOpen,
  extra,
}: {
  canaux: InboxCanal[];
  seen: SeenState;
  notice: { tone: "error" | "success"; text: string } | null;
  onCloseNotice: () => void;
  onOpen: (contactId: string) => void;
  extra?: ReactNode;
}) {
  const rows = sortConversations(canaux);
  const waiting = rows.filter((r) => r.conv.transfertOuvert).length;
  return (
    <div className="space-y-3" data-testid="inbox-mobile-list">
      <h1 className="text-2xl font-semibold">Boîte de réception</h1>
      <PushControls compact />
      {notice && (
        <Notice tone={notice.tone} onClose={onCloseNotice}>
          {notice.text}
        </Notice>
      )}
      {waiting > 0 && (
        <p className="rounded-2xl bg-pink/10 px-4 py-3 text-base font-semibold text-pink" data-testid="inbox-attente">
          🔔 {waiting} conversation{waiting > 1 ? "s attendent" : " attend"} une réponse
        </p>
      )}
      {extra}
      {rows.length === 0 ? (
        <p className="py-10 text-center text-base text-muted">Aucune conversation pour le moment.</p>
      ) : (
        <ul className="-mx-4 divide-y divide-rule border-y border-rule bg-white">
          {rows.map(({ canal, conv }) => {
            const name = who(canal, conv);
            const unread = isUnread(conv, seen);
            const pause = pauseLabel(conv);
            return (
              <li key={conv.contactId}>
                <button type="button" onClick={() => onOpen(conv.contactId)} className="flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-page" data-testid="inbox-row">
                  <span
                    className={`grid size-12 shrink-0 place-items-center rounded-full text-base font-bold ${conv.transfertOuvert ? "bg-pink text-white" : "bg-navy/10 text-navy"}`}
                    aria-hidden
                  >
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate text-base ${unread ? "font-extrabold" : "font-semibold"}`}>{name}</span>
                      <span className={`shrink-0 text-xs ${unread ? "font-bold text-wa" : "text-muted"}`}>{shortTime(lastAt(conv))}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-semibold text-navy" : "text-muted"}`}>
                        {conv.dernierMessage ? `${conv.dernierMessage.sens === "entrant" ? "" : "↪ "}${plainExtract(conv.dernierMessage.texte)}` : "—"}
                      </span>
                      {unread && <span className="size-2.5 shrink-0 rounded-full bg-wa" aria-label="non lu" />}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {conv.transfertOuvert && <span className="rounded-full bg-pink px-2.5 py-0.5 text-xs font-bold text-white">🔔 Attend l&apos;équipe</span>}
                      {pause && !conv.transfertOuvert && <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold">⏸ {pause}</span>}
                      <span className="truncate text-xs text-muted">
                        {canal.plateforme === "instagram" ? "📸" : "💬"} {canal.nomResto}
                        {conv.demoEnCours ? ` · démo ${conv.demoEnCours}` : ""}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MobileConversation({
  canal,
  conv,
  thread,
  notice,
  onCloseNotice,
  onBack,
  onTakeOver,
  onRelease,
  onReply,
}: {
  canal: InboxCanal;
  conv: InboxConversation;
  thread: Thread | null;
  notice: { tone: "error" | "success"; text: string } | null;
  onCloseNotice: () => void;
  onBack: () => void;
  onTakeOver: () => Promise<void> | void;
  onRelease: () => Promise<void> | void;
  onReply: (texte: string) => Promise<boolean>;
}) {
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const vv = useVisualViewport();
  const name = who(canal, conv);
  const pause = pauseLabel(conv);
  const count = thread?.messages.length ?? 0;
  // Clavier ouvert : la partie visible est nettement plus petite que la fenêtre.
  const keyboard = vv.height !== null && typeof window !== "undefined" && window.innerHeight - vv.height > 120;

  // La page derrière ne défile pas tant que la conversation est ouverte.
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  // Dernier message visible : à l'ouverture, à chaque nouveau message (si on était en bas) et à l'ouverture du clavier.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, vv.height]);

  // Zone de réponse : grandit avec le texte (5 lignes au plus).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [texte]);

  async function send() {
    const value = texte.trim();
    if (!value || busy) return;
    setBusy(true);
    stick.current = true;
    if (await onReply(value)) setTexte("");
    setBusy(false);
    input.current?.focus();
  }

  return (
    <div
      role="dialog"
      aria-label={`Conversation avec ${name}`}
      data-testid="inbox-mobile-conversation"
      className="fixed inset-x-0 top-0 z-40 flex flex-col bg-[#efeae2]"
      style={{ height: vv.height ? `${vv.height}px` : "100dvh", transform: `translateY(${vv.offsetTop}px)` }}
    >
      <header className="shrink-0 border-b border-rule bg-white pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-1 px-1 py-1.5">
          <button type="button" onClick={onBack} aria-label="Retour à la liste" className="grid size-11 shrink-0 place-items-center rounded-full active:bg-page">
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${conv.transfertOuvert ? "bg-pink text-white" : "bg-navy/10"}`} aria-hidden>
            {initials(name)}
          </span>
          <span className="min-w-0 flex-1 pl-1">
            <span className="block truncate text-base font-bold">{name}</span>
            <span className="block truncate text-xs text-muted">
              {canal.nomResto} · {conv.fenetreOuverte ? "fenêtre de 24 h ouverte" : "fenêtre de 24 h fermée"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          {conv.pause ? (
            <button type="button" onClick={() => void onRelease()} className="min-h-11 rounded-full bg-navy px-4 text-sm font-semibold text-white" data-testid="mobile-rendre">
              Rendre au bot
            </button>
          ) : (
            <button type="button" onClick={() => void onTakeOver()} className="min-h-11 rounded-full border border-line bg-white px-4 text-sm font-semibold" data-testid="mobile-reprendre">
              Reprendre la main
            </button>
          )}
          <span className="min-w-0 flex-1 text-xs leading-tight text-muted">
            {conv.transfertOuvert && <span className="block font-bold text-pink">🔔 Attend l&apos;équipe</span>}
            {pause ?? "Le bot répond"}
          </span>
        </div>
      </header>

      {notice && (
        <div className="shrink-0 px-3 pt-2">
          <Notice tone={notice.tone} onClose={onCloseNotice}>
            {notice.text}
          </Notice>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3"
        data-testid="inbox-mobile-messages"
      >
        {!thread ? (
          <p className="py-10 text-center text-sm text-muted">Chargement…</p>
        ) : (
          thread.messages.map((m) => (
            <div key={m.id} className={`flex ${m.sens === "entrant" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[85%] overflow-hidden rounded-2xl px-3 py-1.5 text-base leading-snug break-words whitespace-pre-wrap shadow-sm ${
                  m.sens === "entrant" ? "rounded-tl-sm bg-white" : m.auteur === "humain" || m.sens === "echo" ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tr-sm bg-[#e7f0ff]"
                }`}
              >
                {m.sens !== "entrant" && (
                  <span className="mb-0.5 block text-[11px] font-semibold text-muted">{m.sens === "echo" ? "Gérant (appli)" : m.auteur === "humain" ? "Toi" : "Bot"}</span>
                )}
                <MessageContent
                  texte={m.texte}
                  contenu={m.contenu}
                  footer={
                    <span className="mt-0.5 block text-right text-[11px] text-muted">
                      {clock(m.at)}
                      {m.statut === "lu" && " · lu"}
                      {m.statut === "echec" && <span className="text-coral"> · échec{m.erreur ? ` : ${m.erreur}` : ""}</span>}
                    </span>
                  }
                />
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className={`flex shrink-0 items-end gap-2 border-t border-rule bg-white px-2 pt-2 ${keyboard ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {conv.fenetreOuverte ? (
          <>
            <textarea
              ref={input}
              aria-label="Réponse"
              rows={1}
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder={conv.pause ? "Message" : "Message (le bot se met en pause)"}
              className="max-h-[132px] min-h-11 flex-1 resize-none rounded-3xl border border-line bg-page px-4 py-2.5 text-base leading-snug outline-none focus:border-navy/40"
              data-testid="mobile-reponse"
            />
            <button
              type="submit"
              aria-label="Envoyer"
              disabled={!texte.trim() || busy}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-wa text-white disabled:opacity-40"
              data-testid="mobile-envoyer"
            >
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                <path d="M3 20.5 21 12 3 3.5 5.5 12 3 20.5Z M5.5 12H13" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        ) : (
          <p className="min-h-11 flex-1 px-2 py-2 text-sm text-muted">Fenêtre de 24 h fermée : tu pourras répondre quand le client réécrira.</p>
        )}
      </form>
    </div>
  );
}
