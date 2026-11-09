/**
 * Fin de l'Embedded Signup v4 avec coexistence (le resto garde son appli WhatsApp Business sur le même numéro).
 * La page /connecter/<jeton> renvoie le code de Meta et les identifiants (WABA, numéro, portefeuille) ; ici, côté
 * serveur, dans l'ordre :
 *   1. échange du code contre le jeton du client (jeton d'utilisateur système d'intégration, propre à ce client) ;
 *   2. jeton gardé CHIFFRÉ (bot_jetons_whatsapp, AES-256-GCM, clé BOT_JETONS_CLE) : jamais en clair, jamais journalisé ;
 *   3. lecture du numéro (numéro affiché, appli WhatsApp Business ou non) ;
 *   4. abonnement de l'app PFlow Bots aux webhooks du compte du client (AVANT la synchronisation : l'historique n'est
 *      envoyé qu'une fois) ;
 *   5. coexistence : synchronisation des contacts puis de l'historique (à faire dans les 24 h, une seule fois) ;
 *      jamais d'enregistrement du numéro (il l'est déjà par l'appli) ;
 *   6. canal créé en « test » (le bot ne répond qu'aux numéros de test tant que Jules ne l'a pas passé en actif) ;
 *   7. les 10 modèles de la livraison créés sur le compte du client (ceux qui existent déjà sont laissés tels quels).
 * Chaque étape est notée (page État). Les étapes 1, 2 et 6 sont indispensables ; les autres sont notées en erreur
 * sans tout arrêter (elles se refont à la main depuis la page État ou WhatsApp Manager).
 */
import { chiffrerJeton } from "@/lib/jetons-chiffres";
import type { Canal, ChannelStore } from "../core/types";
import type { Connexion, ConnexionEtape, ConnexionStore } from "../core/connexions";
import { LIVRAISON_TEMPLATES, templatePayload } from "./livraison-templates";

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Configuration « WhatsApp Embedded Signup » v4 de Facebook Login for Business. */
  configId: string;
  base: string;
  version: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface SignupInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  /** FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistence) ou FINISH (parcours classique : le numéro quitte l'appli). */
  evenement: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
}

export interface SignupDeps {
  meta: MetaAppConfig;
  connexions: ConnexionStore;
  store: Pick<ChannelStore, "ensureCanal">;
  now?: () => Date;
  /** Chiffrement (injecté dans les tests). */
  chiffrer?: (jeton: string) => string;
}

class MetaError extends Error {}

function metaErrorText(json: Record<string, unknown>, status: number): string {
  const e = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  return e ? `${e.message ?? "erreur"} (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""})` : `HTTP ${status}`;
}

/** Appel à l'API Graph, borné dans le temps. Le jeton passe en en-tête, jamais dans l'URL (sauf l'échange du code). */
async function graph(meta: MetaAppConfig, method: "GET" | "POST", path: string, token: string | null, body?: unknown): Promise<Record<string, unknown>> {
  const doFetch = meta.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), meta.timeoutMs ?? 10_000);
  try {
    const response = await doFetch(`${meta.base.replace(/\/$/, "")}/${meta.version}/${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new MetaError(metaErrorText(json, response.status));
    return json;
  } catch (error) {
    if (error instanceof MetaError) throw error;
    throw new MetaError(`Meta injoignable : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 1. Le code (valable quelques dizaines de secondes) contre le jeton du client. */
export async function echangerCode(meta: MetaAppConfig, code: string): Promise<{ token: string; type?: string }> {
  const q = new URLSearchParams({ client_id: meta.appId, client_secret: meta.appSecret, code });
  const json = await graph(meta, "GET", `oauth/access_token?${q.toString()}`, null);
  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!token) throw new MetaError("Meta n'a pas renvoyé de jeton");
  return { token, type: typeof json.token_type === "string" ? json.token_type : undefined };
}

const ID = /^\d{5,30}$/;
export const idsValides = (i: Pick<SignupInput, "wabaId" | "phoneNumberId" | "businessId">) =>
  ID.test(i.wabaId) && ID.test(i.phoneNumberId) && (!i.businessId || ID.test(i.businessId));

/** Déroule la fin de la connexion et met à jour la demande (étapes, état). Renvoie la demande à jour. */
export async function terminerConnexion(deps: SignupDeps, connexion: Connexion, input: SignupInput): Promise<Connexion> {
  const now = () => (deps.now ? deps.now() : new Date());
  const c: Connexion = {
    ...connexion,
    etat: "en_cours",
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    businessId: input.businessId,
    erreur: undefined,
  };
  const note = (etape: string, ok: boolean, detail?: string) => {
    const e: ConnexionEtape = { etape, ok, le: now().toISOString(), ...(detail ? { detail: detail.slice(0, 300) } : {}) };
    c.etapes = [...c.etapes, e];
  };
  const fail = async (message: string) => {
    c.etat = "erreur";
    c.erreur = message.slice(0, 300);
    await deps.connexions.update(c);
    return c;
  };
  await deps.connexions.update(c);
  const coexistence = input.evenement === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

  // 1. Jeton du client
  let token: string;
  try {
    const t = await echangerCode(deps.meta, input.code);
    token = t.token;
    note("code_echange", true, t.type ? `jeton ${t.type}` : undefined);
    // 2. Gardé chiffré (indispensable : sans lui, le numéro du client ne peut pas être servi)
    await deps.connexions.saveJeton(input.wabaId, c.restaurantId, (deps.chiffrer ?? chiffrerJeton)(token), t.type);
    note("jeton_garde", true, "chiffré (AES-256-GCM)");
  } catch (error) {
    note("code_echange", false, (error as Error).message);
    return fail(`Échange du code ou stockage du jeton impossible : ${(error as Error).message}`);
  }

  // 3. Le numéro
  try {
    const n = await graph(deps.meta, "GET", `${input.phoneNumberId}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`, token);
    c.numeroAffiche = typeof n.display_phone_number === "string" ? n.display_phone_number : undefined;
    note("numero", true, `${c.numeroAffiche ?? "?"}${n.verified_name ? ` · ${n.verified_name}` : ""}${n.is_on_biz_app ? " · appli WhatsApp Business (coexistence)" : ""}`);
  } catch (error) {
    note("numero", false, (error as Error).message);
  }

  // 4. Webhooks du compte du client vers PFlow Bots
  try {
    await graph(deps.meta, "POST", `${input.wabaId}/subscribed_apps`, token);
    note("app_abonnee", true);
  } catch (error) {
    note("app_abonnee", false, (error as Error).message);
  }

  // 5. Coexistence : contacts puis historique (une seule fois, dans les 24 h). Parcours classique : rien à synchroniser,
  //    mais le numéro a quitté l'appli et doit être enregistré (PIN à choisir avec le resto : étape à la main).
  if (coexistence) {
    for (const sync of ["smb_app_state_sync", "history"] as const) {
      try {
        await graph(deps.meta, "POST", `${input.phoneNumberId}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type: sync });
        note(sync === "history" ? "historique_demande" : "contacts_demandes", true);
      } catch (error) {
        note(sync === "history" ? "historique_demande" : "contacts_demandes", false, (error as Error).message);
      }
    }
  } else {
    note("coexistence", false, "Parcours classique : le numéro n'est plus dans l'appli WhatsApp Business. Enregistrement du numéro (PIN) à faire avec le resto.");
  }

  // 6. Canal en test
  try {
    const canal: Omit<Canal, "id"> = {
      restaurantId: c.restaurantId,
      role: "resto",
      plateforme: "whatsapp",
      accountId: input.phoneNumberId,
      wabaId: input.wabaId,
      ...(c.numeroAffiche ? { numeroAffiche: c.numeroAffiche } : {}),
      triggerMode: "toujours",
      coexistence,
      echoPauseHours: 12,
      handoffPauseHours: 24,
      sessionMinutes: 30,
      etat: "test",
      testNumeros: [],
    };
    const r = await deps.store.ensureCanal(canal);
    c.canalId = r.canal.id;
    note("canal", true, r.created ? "créé en test" : `déjà présent (${r.canal.etat}) : laissé tel quel`);
  } catch (error) {
    note("canal", false, (error as Error).message);
    return fail(`Canal non créé : ${(error as Error).message}`);
  }

  // 7. Modèles de la livraison
  try {
    const existants = new Set<string>();
    const liste = await graph(deps.meta, "GET", `${input.wabaId}/message_templates?fields=name,status&limit=200`, token);
    for (const t of (liste.data as { name?: string }[] | undefined) ?? []) if (t.name) existants.add(t.name);
    let crees = 0;
    const echecs: string[] = [];
    for (const t of LIVRAISON_TEMPLATES) {
      if (existants.has(t.name)) continue;
      try {
        await graph(deps.meta, "POST", `${input.wabaId}/message_templates`, token, templatePayload(t));
        crees++;
      } catch (error) {
        echecs.push(`${t.name} : ${(error as Error).message}`);
      }
    }
    const deja = LIVRAISON_TEMPLATES.length - crees - echecs.length;
    note("modeles_livraison", echecs.length === 0, `${crees} créé(s), ${deja} déjà là${echecs.length ? `, ${echecs.length} en échec (${echecs[0]})` : ""}`);
  } catch (error) {
    note("modeles_livraison", false, (error as Error).message);
  }

  c.etat = "terminee";
  c.termineLe = now().toISOString();
  const ratees = c.etapes.filter((e) => !e.ok && e.etape !== "coexistence").map((e) => e.etape);
  if (ratees.length) c.erreur = `Terminé, à reprendre à la main : ${ratees.join(", ")}`;
  await deps.connexions.update(c);
  return c;
}
