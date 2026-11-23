/**
 * Messages de suivi de livraison envoyés par PFlow Order (route /api/webhooks/pflow-livraison). Contrat :
 * docs/livraison/INTERFACE-PFLOW-BOTS.md du CRM (version 1).
 *
 * - Toujours depuis le numéro WhatsApp du RESTO (canal « actif » de ce resto), JAMAIS depuis le numéro PFlow : sans canal
 *   actif, rien ne part (pas_de_canal), PFlow Order réessaie puis alerte Jules.
 * - Fenêtre de 24 h ouverte (le client a écrit au numéro du resto il y a moins de 24 h) : message libre avec le bouton lien
 *   « Suivre ma livraison ». Fermée : le modèle approuvé par Meta (nom logique du CRM traduit vers sa version _v2).
 *   Si Meta répond que la fenêtre est fermée (131047) alors qu'on la croyait ouverte : le modèle, dans le même appel.
 * - Idempotence : la clé est notée AVANT l'appel à Meta. Un renvoi d'un message déjà parti reçoit la même réponse, sans
 *   nouvel envoi. Un envoi qui a échoué peut être refait par l'essai suivant de PFlow Order (même clé).
 * - Le texte et les variables ne sont jamais gardés dans le journal des événements (seulement dans l'historique de la
 *   conversation, comme tout message envoyé) ; le numéro y est masqué.
 */
import { z } from "zod";
import { canSendFreeform } from "@/engine";
import { maskId } from "../core/privacy";
import { sendOptions } from "../core/send-options";
import type { Canal, ChannelSender, ChannelStore } from "../core/types";
import { GraphError } from "../whatsapp/graph";
import { nomModeleLivraison } from "../whatsapp/livraison-templates";

/** Un essai resté « en cours » plus longtemps (plantage pendant l'envoi) peut être refait. */
export const LIVRAISON_EN_COURS_MAX_MS = 2 * 60 * 1000;

const text = (max: number) => z.string().max(max);

export const livraisonPayloadSchema = z.object({
  type: z.literal("livraison"),
  version: z.number().int(),
  idempotence: z.string().min(1).max(200),
  notification_id: z.union([z.number(), z.string()]).optional(),
  evenement: text(60),
  restaurant_id: z.string().uuid(),
  slug: text(200).nullish(),
  commande_id: text(100).nullish(),
  commande_numero: text(60).nullish(),
  canal_commande: text(40).nullish(),
  delivery_id: text(100).nullish(),
  client_tel: z.string().regex(/^\d{6,20}$/),
  texte: text(1024).nullish(),
  bouton: z.object({ texte: text(40), url: z.string().url().max(2000) }).nullish(),
  modele: z
    .object({
      nom: text(200),
      langue: text(10).optional(),
      variables: z.array(text(1000)).max(10),
      bouton_url_suffixe: text(500).nullish(),
    })
    .nullish(),
  contient_code: z.boolean().optional(),
});
export type LivraisonPayload = z.infer<typeof livraisonPayloadSchema>;

export type LivraisonResponse =
  | { pris: true; etat: "envoye"; via: "libre" | "modele"; message_id: string | null }
  | { pris: false; raison: string; detail?: string };

export interface LivraisonDeps {
  store: ChannelStore;
  graph: ChannelSender;
  now?(): Date;
}

/** Le canal WhatsApp ACTIF du resto (rôle « resto ») ; jamais le numéro PFlow, jamais un canal en test ou coupé. */
export async function canalLivraison(store: ChannelStore, restaurantId: string): Promise<Canal | null> {
  const canaux = await store.listCanaux();
  return canaux.find((c) => c.restaurantId === restaurantId && c.plateforme === "whatsapp" && (c.role ?? "resto") === "resto" && c.etat === "actif") ?? null;
}

const court = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Erreur de Meta → réponse du contrat (§9). Le détail est masqué (aucun numéro) et court. */
function refus(error: unknown, modele: boolean): LivraisonResponse {
  const code = error instanceof GraphError ? error.code : undefined;
  const message = maskId(error instanceof Error ? error.message : String(error));
  const detail = court(`${code ?? ""} ${message}`.trim(), 300);
  // 131026 : message impossible à remettre (numéro sans WhatsApp) ; 131021 : le client est le numéro du resto.
  if (code === 131026 || code === 131021) return { pris: false, raison: "numero_invalide", detail };
  // 132xxx : modèle inexistant, pas approuvé, en pause, désactivé, ou variables qui ne correspondent pas.
  if (modele && code !== undefined && code >= 132000 && code < 133000) return { pris: false, raison: "modele_absent", detail };
  return { pris: false, raison: "erreur_meta", detail };
}

/** Code de Meta « fenêtre de 24 h fermée » (re-engagement) : l'envoi libre doit passer par le modèle. */
const fenetreFermee = (error: unknown) => error instanceof GraphError && (error.code === 131047 || error.code === 470);

export async function handleLivraisonEvent(payload: LivraisonPayload, deps: LivraisonDeps): Promise<LivraisonResponse> {
  if (payload.version !== 1) return { pris: false, raison: "version_inconnue" };
  const now = deps.now ? deps.now() : new Date();

  const canal = await canalLivraison(deps.store, payload.restaurant_id);
  if (!canal) return { pris: false, raison: "pas_de_canal" };

  // Idempotence (§6) : clé notée avant Meta. Aucun texte ni variable dans la charge, numéro masqué.
  const key = `livraison:${payload.idempotence}`;
  const charge = { evenement: payload.evenement, notification_id: payload.notification_id ?? null, slug: payload.slug ?? null, client: maskId(payload.client_tel) };
  if (!(await deps.store.claimEvent("pflow_order", key, charge))) {
    const vu = await deps.store.getEvent("pflow_order", key);
    const resultat = (vu?.charge as { resultat?: LivraisonResponse } | undefined)?.resultat;
    if (vu?.done && !vu.error && resultat?.pris) return resultat;
    if (vu && !vu.done && now.getTime() - Date.parse(vu.at) < LIVRAISON_EN_COURS_MAX_MS) return { pris: false, raison: "en_cours" };
    // Essai précédent en échec (ou bloqué) : on le refait.
    await deps.store.releaseEvent("pflow_order", key);
    if (!(await deps.store.claimEvent("pflow_order", key, charge))) return { pris: false, raison: "en_cours" };
  }
  const fin = async (r: LivraisonResponse) => {
    await deps.store.finishEvent("pflow_order", key, r.pris ? undefined : court(`${r.raison}${r.detail ? ` ${r.detail}` : ""}`, 300), r.pris ? { ...charge, resultat: r } : undefined);
    return r;
  };

  const contact = await deps.store.getOrCreateContact(canal.id, payload.client_tel);
  const options = sendOptions(canal);
  const lien = payload.bouton ? { kind: "link" as const, text: payload.texte ?? "", url: payload.bouton.url, buttonLabel: payload.bouton.texte } : null;
  // Ce qui s'affiche dans la boîte de réception du resto (le message vu par le client).
  const contenu = lien ?? { kind: "text" as const, text: payload.texte ?? "" };
  // Le message est parti : un échec de l'historique ne doit pas le faire renvoyer (il serait reçu deux fois).
  const garder = async (type: "libre" | "modele", wamid: string | undefined) => {
    try {
      await deps.store.addMessage({ canalId: canal.id, contactId: contact.id, sens: "sortant", auteur: "bot", wamid, type: type === "modele" ? "template" : contenu.kind, contenu: type === "modele" ? { ...contenu, modele: nomModeleLivraison(payload.modele?.nom ?? "") } : contenu, statut: "envoye" });
    } catch (error) {
      console.error("[pflow-livraison] historique non enregistré :", maskId(error instanceof Error ? error.message : String(error)));
    }
  };

  const envoyerModele = async (): Promise<LivraisonResponse> => {
    const nom = payload.modele ? nomModeleLivraison(payload.modele.nom) : null;
    if (!nom || !payload.modele || !deps.graph.sendTemplate) return { pris: false, raison: "modele_absent", detail: court(`modèle inconnu : ${payload.modele?.nom ?? "aucun"}`, 300) };
    try {
      const wamid = await deps.graph.sendTemplate(
        canal.accountId,
        payload.client_tel,
        { name: nom, language: payload.modele.langue || "fr", variables: payload.modele.variables, urlSuffix: payload.modele.bouton_url_suffixe ?? null },
        options,
      );
      await garder("modele", wamid);
      return { pris: true, etat: "envoye", via: "modele", message_id: wamid ?? null };
    } catch (error) {
      return refus(error, true);
    }
  };

  // Fenêtre ouverte : message libre (jamais un modèle, choix de Jules : il entre dans les messages de service gratuits).
  if (payload.texte && canSendFreeform(contact.state, now)) {
    try {
      const wamid = await deps.graph.send(canal.accountId, payload.client_tel, contenu, options);
      await garder("libre", wamid);
      return fin({ pris: true, etat: "envoye", via: "libre", message_id: wamid ?? null });
    } catch (error) {
      if (!fenetreFermee(error)) return fin(refus(error, false));
      // Meta dit que la fenêtre est fermée : le modèle.
    }
  }
  return fin(await envoyerModele());
}
