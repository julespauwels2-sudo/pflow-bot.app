/**
 * Boîte de réception : réponse affichée tout de suite (avant la réponse de Meta), puis confirmée.
 * Fonctions pures (testées) : l'écran garde ses envois « en cours » à part et les fusionne avec la conversation
 * rechargée, sans doublon ni saut.
 * - au clic : un envoi provisoire (id provisoire, « envoi… ») est ajouté en bas de la conversation ;
 * - réponse du serveur : l'envoi garde son id provisoire comme clé d'affichage et retient l'id réel du message
 *   enregistré (« envoyé ✓ », ou « échec » avec « Réessayer ») ;
 * - quand la conversation rechargée contient l'id réel, c'est le message du serveur qui s'affiche, sous la même clé
 *   (pas de remontage, pas de doublon). Un rechargement parti AVANT l'enregistrement (sans le message) ne le fait pas
 *   disparaître : l'envoi provisoire reste affiché tant que le serveur ne l'a pas renvoyé.
 */
import type { InboxCanal, InboxConversation } from "@/channels/core/inbox";
import type { StoredMessage } from "@/channels/core/types";

export type MessageAffiche = StoredMessage & { texte: string };

export type EtatEnvoi = "envoi" | "envoye" | "echec";

export interface EnvoiLocal {
  /** Id provisoire, gardé comme clé d'affichage jusqu'au bout. */
  tempId: string;
  texte: string;
  /** Heure du clic (ISO). */
  at: string;
  etat: EtatEnvoi;
  /** Id du message enregistré par le serveur (succès, ou échec de Meta gardé dans la conversation). */
  realId?: string;
  erreur?: string;
}

/** Message tel qu'affiché : sa clé stable et, pour un envoi fait depuis cet écran, son état. */
export type LigneConversation = MessageAffiche & { cle: string; envoi?: { tempId: string; etat: EtatEnvoi; erreur?: string } };

let compteur = 0;
export function nouvelEnvoi(texte: string, now: Date = new Date()): EnvoiLocal {
  compteur += 1;
  return { tempId: `tmp-${now.getTime()}-${compteur}`, texte, at: now.toISOString(), etat: "envoi" };
}

/** Résultat de l'envoi : id réel et état. */
export function reglerEnvoi(envois: EnvoiLocal[], tempId: string, resultat: { ok: true; message?: { id: string } } | { ok: false; erreur: string; message?: { id: string } }): EnvoiLocal[] {
  return envois.map((e) =>
    e.tempId !== tempId
      ? e
      : resultat.ok
        ? { ...e, etat: "envoye", ...(resultat.message ? { realId: resultat.message.id } : {}) }
        : { ...e, etat: "echec", erreur: resultat.erreur, ...(resultat.message ? { realId: resultat.message.id } : {}) },
  );
}

/** Conversation affichée = messages du serveur + envois de cet écran pas encore renvoyés par le serveur. */
export function fusionnerConversation(messages: MessageAffiche[], envois: EnvoiLocal[], contexte: { canalId: string; contactId: string }): LigneConversation[] {
  const parReel = new Map(envois.filter((e) => e.realId).map((e) => [e.realId!, e]));
  const vus = new Set<string>();
  const lignes: LigneConversation[] = messages.map((m) => {
    const envoi = parReel.get(m.id);
    if (!envoi) return { ...m, cle: m.id };
    vus.add(envoi.tempId);
    // Message du serveur, sous la clé provisoire. Un échec garde son « Réessayer » ; un succès n'a plus besoin d'état.
    return { ...m, cle: envoi.tempId, ...(envoi.etat === "echec" ? { envoi: { tempId: envoi.tempId, etat: envoi.etat, erreur: envoi.erreur ?? m.erreur } } : {}) };
  });
  for (const e of envois) {
    if (vus.has(e.tempId)) continue;
    lignes.push({
      id: e.realId ?? e.tempId,
      cle: e.tempId,
      canalId: contexte.canalId,
      contactId: contexte.contactId,
      sens: "sortant",
      auteur: "humain",
      type: "text",
      contenu: { kind: "text", text: e.texte },
      texte: e.texte,
      at: e.at,
      ...(e.etat === "echec" ? { statut: "echec" as const, ...(e.erreur ? { erreur: e.erreur } : {}) } : e.etat === "envoye" ? { statut: "envoye" as const } : {}),
      envoi: { tempId: e.tempId, etat: e.etat, ...(e.erreur ? { erreur: e.erreur } : {}) },
    });
  }
  return lignes;
}

/** Après un envoi réussi : la liste montre tout de suite le dernier message et la pause du bot (sans recharger). */
export function majConversationListe(canaux: InboxCanal[], contactId: string, patch: { pause?: InboxConversation["pause"]; dernierMessage?: InboxConversation["dernierMessage"] }): InboxCanal[] {
  return canaux.map((canal) =>
    canal.conversations.some((c) => c.contactId === contactId)
      ? {
          ...canal,
          conversations: canal.conversations.map((c) =>
            c.contactId !== contactId
              ? c
              : {
                  ...c,
                  ...("pause" in patch ? { pause: patch.pause ?? null } : {}),
                  ...(patch.dernierMessage ? { dernierMessage: patch.dernierMessage, updatedAt: patch.dernierMessage.at } : {}),
                },
          ),
        }
      : canal,
  );
}

/** Mention affichée sous un message envoyé par l'équipe. */
export function mentionEnvoi(ligne: Pick<LigneConversation, "envoi" | "statut" | "auteur" | "sens">): string | null {
  if (ligne.envoi?.etat === "envoi") return "envoi…";
  if (ligne.envoi?.etat === "echec") return null; // l'échec a son propre affichage (erreur + « Réessayer »)
  if (ligne.sens === "sortant" && ligne.auteur === "humain" && (ligne.statut === "envoye" || ligne.envoi?.etat === "envoye")) return "envoyé ✓";
  return null;
}
