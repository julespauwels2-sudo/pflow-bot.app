"use client";

/**
 * Boîte de réception : éléments communs à l'ordinateur et au téléphone.
 * - EtatBadge : l'état unique d'une conversation (bot actif, en pause : transfert / l'équipe a répondu / main reprise,
 *   ignoré : pas de mot-clé) ;
 * - BarreEtat : cet état en clair, avec « Rendre au bot » (toutes les pauses) ou « Reprendre la main » ;
 * - BulleMessage : client à gauche, bot (bleu) et équipe (rose) à droite, chacun nommé, avec l'heure, et la raison
 *   quand le bot n'a pas répondu à un message du client ;
 * - FiltresInbox : filtre par resto, numéros de test de Meta masqués par défaut.
 */
import type { ReactNode } from "react";
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import { mentionEnvoi, type LigneConversation } from "@/lib/inbox-envoi";
import { auteurLabel, etatLabel, noteLabel, restosDuFiltre, type InboxFiltre } from "@/lib/inbox-view";
import { MessageContent } from "./message-content";

const TONS = {
  actif: "bg-emerald-100 text-emerald-900",
  pause: "bg-ink/10 text-ink",
  alerte: "bg-brand text-nuit",
  ignore: "bg-amber-100 text-amber-900",
} as const;

export function EtatBadge({ conv, className = "" }: { conv: InboxConversation; className?: string }) {
  const { texte, ton } = etatLabel(conv.etat);
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${TONS[ton]} ${className}`} data-testid="inbox-etat" data-etat={conv.etat.code}>
      {texte}
    </span>
  );
}

const EXPLICATIONS: Record<InboxConversation["etat"]["code"], string> = {
  actif: "Le bot répond à ce client.",
  ignore: "Le bot est actif, mais il a laissé passer le dernier message (aucun mot-clé). Réponds à la main si besoin.",
  transfert: "Le client a demandé l'équipe : le bot se tait. Il reprend si le client renvoie un mot-clé (bonjour, commande, menu…) ou si tu le rends au bot.",
  equipe: "L'équipe a répondu à la main : le bot se tait. Si le client réécrit et que personne ne lui répond dans le délai, le bot reprend en tenant compte de ce que l'équipe a dit.",
  main: "Tu as repris la main : le bot se tait jusqu'à ce que tu le lui rendes.",
};

export function BarreEtat({ conv, onTakeOver, onRelease, sombre = false }: { conv: InboxConversation; onTakeOver: () => void; onRelease: () => void; sombre?: boolean }) {
  const enPause = conv.etat.code === "transfert" || conv.etat.code === "equipe" || conv.etat.code === "main";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inbox-barre-etat">
      <EtatBadge conv={conv} />
      {enPause ? (
        <button type="button" onClick={onRelease} className="bg-brand shadow-bouton min-h-11 rounded-full px-4 text-sm font-bold text-nuit" data-testid="inbox-rendre">
          🤖 Rendre au bot
        </button>
      ) : (
        <button type="button" onClick={onTakeOver} className="min-h-11 rounded-full border border-ink/15 carte px-4 text-sm font-bold text-ink" data-testid="inbox-reprendre">
          ✋ Reprendre la main
        </button>
      )}
      <p className={`w-full text-xs leading-snug ${sombre ? "text-white/70" : "text-muted"}`}>
        {EXPLICATIONS[conv.etat.code]}
        {enPause && " « Rendre au bot » : il répond de nouveau dès le prochain message du client."}
      </p>
    </div>
  );
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** Séparateur de jour avant le premier message de chaque jour. */
export function SeparateurJour({ at }: { at: string }) {
  return (
    <p className="py-1 text-center">
      <span className="rounded-full bg-white/80 px-3 py-0.5 text-[11px] font-semibold text-ink">{jour(at)}</span>
    </p>
  );
}

export function BulleMessage({ m, onRetry, grand = false }: { m: LigneConversation; onRetry: (tempId: string) => void; grand?: boolean }) {
  const auteur = auteurLabel(m);
  const note = m.sens === "entrant" ? noteLabel(m.erreur) : null;
  const fond = auteur.ton === "client" ? "carte rounded-tl-sm" : auteur.ton === "equipe" ? "aplat-rose rounded-tr-sm" : "aplat-bleu rounded-tr-sm";
  return (
    <div data-testid="inbox-message" data-auteur={auteur.ton} data-etat={m.envoi?.etat} className={`flex flex-col ${auteur.cote === "gauche" ? "items-start" : "items-end"}`}>
      <div className={`max-w-[85%] overflow-hidden rounded-2xl px-3 py-1.5 leading-snug break-words whitespace-pre-wrap ${grand ? "text-base" : "text-sm font-medium"} ${fond}`}>
        <span className="mb-0.5 block text-[11px] font-bold text-muted">{auteur.texte}</span>
        <MessageContent
          texte={m.texte}
          contenu={m.contenu}
          footer={
            <span className="mt-0.5 block text-right text-[11px] text-muted">
              {heure(m.at)}
              {mentionEnvoi(m) && <span data-testid="inbox-envoi-etat"> · {mentionEnvoi(m)}</span>}
              {m.statut === "lu" && m.sens !== "entrant" && " · lu ✓✓"}
              {m.statut === "echec" && <span className="text-alerte"> · échec{m.erreur ? ` : ${m.erreur}` : ""}</span>}
              {m.envoi?.etat === "echec" && (
                <button type="button" className="ml-1 font-bold text-rose underline" onClick={() => onRetry(m.envoi!.tempId)}>
                  Réessayer
                </button>
              )}
            </span>
          }
        />
      </div>
      {note && (
        <span className="mt-0.5 ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900" data-testid="inbox-note">
          🚫 {note}
        </span>
      )}
    </div>
  );
}

/** Messages de la conversation, avec un séparateur à chaque nouveau jour. */
export function ListeMessages({ lignes, onRetry, grand = false }: { lignes: LigneConversation[]; onRetry: (tempId: string) => void; grand?: boolean }) {
  const out: ReactNode[] = [];
  let dernierJour = "";
  for (const m of lignes) {
    const j = new Date(m.at).toDateString();
    if (j !== dernierJour) {
      out.push(<SeparateurJour key={`j-${m.cle}`} at={m.at} />);
      dernierJour = j;
    }
    out.push(<BulleMessage key={m.cle} m={m} onRetry={onRetry} grand={grand} />);
  }
  return <>{out}</>;
}

export function FiltresInbox({ canaux, filtre, onChange, sombre = false }: { canaux: InboxCanal[]; filtre: InboxFiltre; onChange: (f: InboxFiltre) => void; sombre?: boolean }) {
  const restos = restosDuFiltre(canaux, filtre.numerosTest);
  const nbTest = canaux.filter((c) => c.testMeta).reduce((n, c) => n + c.conversations.length, 0);
  return (
    <div className={`flex flex-wrap items-center gap-3 text-sm ${sombre ? "text-white" : ""}`} data-testid="inbox-filtres">
      <label className="flex items-center gap-2">
        <span className="font-semibold">Resto</span>
        <select
          aria-label="Filtrer par resto"
          className="min-h-11 rounded-xl border border-line bg-white px-3 py-1 font-semibold text-nuit"
          value={filtre.resto}
          onChange={(e) => onChange({ ...filtre, resto: e.target.value })}
        >
          <option value="">Tous les restos</option>
          {restos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nom}
            </option>
          ))}
        </select>
      </label>
      {nbTest > 0 && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-pink" checked={filtre.numerosTest} onChange={(e) => onChange({ ...filtre, numerosTest: e.target.checked })} />
          Numéros de test Meta ({nbTest})
        </label>
      )}
    </div>
  );
}

/** Recherche par nom, numéro ou contenu d'un message, avec l'état de la mise à jour (temps réel ou toutes les 5 s). */
export function RechercheInbox({ value, onChange, sync, sombre = false }: { value: string; onChange: (v: string) => void; sync: "temps-reel" | "rafraichissement"; sombre?: boolean }) {
  return (
    <div className="space-y-1">
      <input
        type="search"
        aria-label="Rechercher une conversation"
        placeholder="🔎 Nom, numéro ou message…"
        className="min-h-11 w-full rounded-xl border border-line bg-white px-3 py-1 text-base text-nuit"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="inbox-recherche"
      />
      <p className={`text-[11px] ${sombre ? "text-white/60" : "text-muted"}`} data-testid="inbox-sync">
        {sync === "temps-reel" ? "● Mise à jour en temps réel" : "○ Mise à jour toutes les 5 s"}
      </p>
    </div>
  );
}
