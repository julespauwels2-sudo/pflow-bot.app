/**
 * « Connecter votre WhatsApp » (Embedded Signup) : les demandes de connexion (lien unique et expirant envoyé au gérant)
 * et les jetons Meta chiffrés des clients. Tables bot_connexions_whatsapp et bot_jetons_whatsapp
 * (supabase/migrations/20261111000000_bot_connexions_whatsapp.sql). Mémoire pour les tests et le mode démo.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db, Row } from "@/data/supabase/db";

export type ConnexionEtat = "lien_envoye" | "en_cours" | "terminee" | "erreur" | "annulee" | "expiree" | "debranchee";

export interface ConnexionEtape {
  etape: string;
  ok: boolean;
  detail?: string;
  le: string;
}

export interface Connexion {
  id: string;
  restaurantId: string;
  /** Client test hors CRM (vidéo de l'examen Meta) : son nom ; le canal n'est relié à aucun resto. */
  clientTest?: boolean;
  libelle?: string;
  jetonHash: string;
  expireLe: string;
  etat: ConnexionEtat;
  businessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  numeroAffiche?: string;
  canalId?: string;
  etapes: ConnexionEtape[];
  erreur?: string;
  creePar?: string;
  creeLe: string;
  majLe: string;
  termineLe?: string;
}

/** Jeton Meta d'un client (Embedded Signup) : chiffré, avec sa date d'expiration (null : inconnue ou jamais). */
export interface JetonStocke {
  wabaId: string;
  restaurantId: string;
  chiffre: string;
  type?: string;
  /** Fin de validité annoncée par Meta (60 jours pour la configuration de PFlow) ; null : n'expire pas ou inconnue. */
  expireLe: string | null;
  /** « jamais » : Meta indique que le jeton n'expire pas. */
  nExpirePas?: boolean;
  renouveleLe?: string;
  /** Dernière erreur de renouvellement (vide si le dernier renouvellement a réussi). */
  erreur?: string;
  majLe?: string;
}

export interface JetonExpiration {
  expireLe: string | null;
  nExpirePas?: boolean;
}

export interface ConnexionStore {
  create(c: Omit<Connexion, "id" | "creeLe" | "majLe" | "etapes" | "etat">): Promise<Connexion>;
  byJetonHash(hash: string): Promise<Connexion | null>;
  update(c: Connexion): Promise<void>;
  list(limit?: number): Promise<Connexion[]>;
  saveJeton(wabaId: string, restaurantId: string, chiffre: string, type?: string, expiration?: JetonExpiration): Promise<void>;
  /** Tous les jetons des clients (renouvellement, page État). */
  listJetons(): Promise<JetonStocke[]>;
  /** Après un renouvellement (nouveau jeton, nouvelle échéance) ou un échec (erreur gardée, jeton inchangé). */
  majJeton(wabaId: string, maj: { chiffre?: string; expiration?: JetonExpiration; renouveleLe?: string; erreur?: string | null }): Promise<void>;
  /** Le jeton chiffré du compte WhatsApp (null : on utilise le jeton général de PFlow). */
  jetonChiffre(wabaId: string): Promise<string | null>;
  /** Débranchement : le jeton du client est effacé (plus aucun accès à son compte). */
  deleteJeton(wabaId: string): Promise<void>;
}

/** Jeton du lien : 32 octets aléatoires (base64url). Seule son empreinte est gardée. */
export function nouveauJetonLien(): string {
  return randomBytes(32).toString("base64url");
}
export const hashJeton = (jeton: string) => createHash("sha256").update(jeton).digest("hex");
/** Forme d'un jeton de lien (évite toute requête pour un lien fantaisiste). */
export const jetonValide = (jeton: string) => /^[A-Za-z0-9_-]{40,64}$/.test(jeton);

/** État affiché : un lien jamais utilisé et dépassé est « expiré ». */
export function etatEffectif(c: Connexion, now = new Date()): ConnexionEtat {
  if ((c.etat === "lien_envoye" || c.etat === "annulee") && Date.parse(c.expireLe) <= now.getTime()) return "expiree";
  return c.etat;
}

export function createMemoryConnexionStore(): ConnexionStore {
  const rows = new Map<string, Connexion>();
  const jetons = new Map<string, JetonStocke>();
  return {
    async create(c) {
      const now = new Date().toISOString();
      const full: Connexion = { ...c, id: randomBytes(8).toString("hex"), etat: "lien_envoye", etapes: [], creeLe: now, majLe: now };
      rows.set(full.id, full);
      return structuredClone(full);
    },
    async byJetonHash(hash) {
      const found = [...rows.values()].find((c) => c.jetonHash === hash);
      return found ? structuredClone(found) : null;
    },
    async update(c) {
      rows.set(c.id, structuredClone({ ...c, majLe: new Date().toISOString() }));
    },
    async list(limit = 50) {
      return [...rows.values()].sort((a, b) => b.creeLe.localeCompare(a.creeLe)).slice(0, limit).map((c) => structuredClone(c));
    },
    async saveJeton(wabaId, restaurantId, chiffre, type, expiration) {
      jetons.set(wabaId, { wabaId, restaurantId, chiffre, type, expireLe: expiration?.expireLe ?? null, nExpirePas: expiration?.nExpirePas, majLe: new Date().toISOString() });
    },
    async listJetons() {
      return [...jetons.values()].map((j) => structuredClone(j));
    },
    async majJeton(wabaId, maj) {
      const j = jetons.get(wabaId);
      if (!j) return;
      jetons.set(wabaId, {
        ...j,
        ...(maj.chiffre ? { chiffre: maj.chiffre } : {}),
        ...(maj.expiration ? { expireLe: maj.expiration.expireLe, nExpirePas: maj.expiration.nExpirePas } : {}),
        ...(maj.renouveleLe ? { renouveleLe: maj.renouveleLe } : {}),
        ...(maj.erreur !== undefined ? { erreur: maj.erreur ?? undefined } : {}),
        majLe: new Date().toISOString(),
      });
    },
    async jetonChiffre(wabaId) {
      return jetons.get(wabaId)?.chiffre ?? null;
    },
    async deleteJeton(wabaId) {
      jetons.delete(wabaId);
    },
  };
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : undefined);
const opt = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : String(v));

function rowToConnexion(r: Row): Connexion {
  return {
    id: String(r.id),
    restaurantId: String(r.restaurant_id),
    ...(r.client_test ? { clientTest: true } : {}),
    libelle: opt(r.libelle),
    jetonHash: String(r.jeton_hash),
    expireLe: iso(r.expire_le)!,
    etat: String(r.etat) as ConnexionEtat,
    businessId: opt(r.business_id),
    wabaId: opt(r.waba_id),
    phoneNumberId: opt(r.phone_number_id),
    numeroAffiche: opt(r.numero_affiche),
    canalId: opt(r.canal_id),
    etapes: Array.isArray(r.etapes) ? (r.etapes as ConnexionEtape[]) : [],
    erreur: opt(r.erreur),
    creePar: opt(r.cree_par),
    creeLe: iso(r.cree_le)!,
    majLe: iso(r.maj_le)!,
    termineLe: iso(r.termine_le),
  };
}

function connexionToRow(c: Connexion): Row {
  return {
    id: c.id,
    restaurant_id: c.restaurantId,
    client_test: Boolean(c.clientTest),
    libelle: c.libelle ?? null,
    jeton_hash: c.jetonHash,
    expire_le: c.expireLe,
    etat: c.etat,
    business_id: c.businessId ?? null,
    waba_id: c.wabaId ?? null,
    phone_number_id: c.phoneNumberId ?? null,
    numero_affiche: c.numeroAffiche ?? null,
    canal_id: c.canalId ?? null,
    etapes: c.etapes,
    erreur: c.erreur ?? null,
    cree_par: c.creePar ?? null,
    cree_le: c.creeLe,
    maj_le: new Date().toISOString(),
    termine_le: c.termineLe ?? null,
  };
}

const eq = (column: string, value: string) => ({ in: { column, values: [value] } });

const COLONNES_EXPIRATION = ["expire_le", "n_expire_pas", "renouvele_le", "erreur_renouvellement"];

/**
 * Enregistre le jeton avec ses colonnes d'expiration (migration 20261112000000). Si la migration n'est pas encore
 * jouée (colonnes absentes), le jeton est quand même gardé, sans l'échéance : la connexion d'un client ne casse jamais.
 */
async function upsertJeton(db: Db, base: Row, expiration: Row): Promise<void> {
  const sansExpiration = Object.fromEntries(Object.entries(base).filter(([k]) => !COLONNES_EXPIRATION.includes(k)));
  try {
    await db.upsert("bot_jetons_whatsapp", [{ ...sansExpiration, ...pick(base, COLONNES_EXPIRATION), ...expiration }], "waba_id");
  } catch (error) {
    if (!/expire_le|n_expire_pas|renouvele_le|erreur_renouvellement|column/i.test(error instanceof Error ? error.message : String(error))) throw error;
    await db.upsert("bot_jetons_whatsapp", [sansExpiration], "waba_id");
  }
}
const pick = (row: Row, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));

function rowToJeton(r: Row): JetonStocke {
  return {
    wabaId: String(r.waba_id),
    restaurantId: String(r.restaurant_id),
    chiffre: String(r.jeton_chiffre),
    type: opt(r.type_jeton),
    expireLe: iso(r.expire_le) ?? null,
    nExpirePas: r.n_expire_pas === true,
    renouveleLe: iso(r.renouvele_le),
    erreur: opt(r.erreur_renouvellement),
    majLe: iso(r.maj_le),
  };
}

export function createSupabaseConnexionStore(db: Db): ConnexionStore {
  return {
    async create(c) {
      const now = new Date().toISOString();
      const full: Connexion = { ...c, id: crypto.randomUUID(), etat: "lien_envoye", etapes: [], creeLe: now, majLe: now };
      await db.upsert("bot_connexions_whatsapp", [connexionToRow(full)], "id");
      return full;
    },
    async byJetonHash(hash) {
      const [row] = await db.select("bot_connexions_whatsapp", "*", eq("jeton_hash", hash));
      return row ? rowToConnexion(row) : null;
    },
    async update(c) {
      await db.upsert("bot_connexions_whatsapp", [connexionToRow(c)], "id");
    },
    async list(limit = 50) {
      return (await db.select("bot_connexions_whatsapp", "*", { order: { column: "cree_le", ascending: false }, limit })).map(rowToConnexion);
    },
    async saveJeton(wabaId, restaurantId, chiffre, type, expiration) {
      const base = { waba_id: wabaId, restaurant_id: restaurantId, jeton_chiffre: chiffre, type_jeton: type ?? null, maj_le: new Date().toISOString() };
      await upsertJeton(db, base, {
        expire_le: expiration?.expireLe ?? null,
        n_expire_pas: Boolean(expiration?.nExpirePas),
        renouvele_le: null,
        erreur_renouvellement: null,
      });
    },
    async listJetons() {
      return (await db.select("bot_jetons_whatsapp", "*")).map(rowToJeton);
    },
    async majJeton(wabaId, maj) {
      const [row] = await db.select("bot_jetons_whatsapp", "*", eq("waba_id", wabaId));
      if (!row) return;
      const base = { ...row, ...(maj.chiffre ? { jeton_chiffre: maj.chiffre } : {}), maj_le: new Date().toISOString() };
      await upsertJeton(db, base, {
        ...(maj.expiration ? { expire_le: maj.expiration.expireLe, n_expire_pas: Boolean(maj.expiration.nExpirePas) } : {}),
        ...(maj.renouveleLe ? { renouvele_le: maj.renouveleLe } : {}),
        ...(maj.erreur !== undefined ? { erreur_renouvellement: maj.erreur } : {}),
      });
    },
    async jetonChiffre(wabaId) {
      const [row] = await db.select("bot_jetons_whatsapp", "jeton_chiffre", eq("waba_id", wabaId));
      return row ? String(row.jeton_chiffre) : null;
    },
    async deleteJeton(wabaId) {
      await db.remove("bot_jetons_whatsapp", "waba_id", [wabaId]);
    },
  };
}
