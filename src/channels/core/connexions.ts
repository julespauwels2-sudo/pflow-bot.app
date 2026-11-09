/**
 * « Connecter votre WhatsApp » (Embedded Signup) : les demandes de connexion (lien unique et expirant envoyé au gérant)
 * et les jetons Meta chiffrés des clients. Tables bot_connexions_whatsapp et bot_jetons_whatsapp
 * (supabase/migrations/20261111000000_bot_connexions_whatsapp.sql). Mémoire pour les tests et le mode démo.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db, Row } from "@/data/supabase/db";

export type ConnexionEtat = "lien_envoye" | "en_cours" | "terminee" | "erreur" | "annulee" | "expiree";

export interface ConnexionEtape {
  etape: string;
  ok: boolean;
  detail?: string;
  le: string;
}

export interface Connexion {
  id: string;
  restaurantId: string;
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

export interface ConnexionStore {
  create(c: Omit<Connexion, "id" | "creeLe" | "majLe" | "etapes" | "etat">): Promise<Connexion>;
  byJetonHash(hash: string): Promise<Connexion | null>;
  update(c: Connexion): Promise<void>;
  list(limit?: number): Promise<Connexion[]>;
  saveJeton(wabaId: string, restaurantId: string, chiffre: string, type?: string): Promise<void>;
  /** Le jeton chiffré du compte WhatsApp (null : on utilise le jeton général de PFlow). */
  jetonChiffre(wabaId: string): Promise<string | null>;
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
  const jetons = new Map<string, { restaurantId: string; chiffre: string; type?: string }>();
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
    async saveJeton(wabaId, restaurantId, chiffre, type) {
      jetons.set(wabaId, { restaurantId, chiffre, type });
    },
    async jetonChiffre(wabaId) {
      return jetons.get(wabaId)?.chiffre ?? null;
    },
  };
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : undefined);
const opt = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : String(v));

function rowToConnexion(r: Row): Connexion {
  return {
    id: String(r.id),
    restaurantId: String(r.restaurant_id),
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
    async saveJeton(wabaId, restaurantId, chiffre, type) {
      await db.upsert(
        "bot_jetons_whatsapp",
        [{ waba_id: wabaId, restaurant_id: restaurantId, jeton_chiffre: chiffre, type_jeton: type ?? null, maj_le: new Date().toISOString() }],
        "waba_id",
      );
    },
    async jetonChiffre(wabaId) {
      const [row] = await db.select("bot_jetons_whatsapp", "jeton_chiffre", eq("waba_id", wabaId));
      return row ? String(row.jeton_chiffre) : null;
    },
  };
}
