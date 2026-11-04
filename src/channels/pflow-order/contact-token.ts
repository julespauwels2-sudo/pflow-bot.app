/**
 * Jeton de pré-remplissage du lien « Commander » (option 3 du lien de commande, étape C) : numéro
 * WhatsApp, prénom, resto et expiration, CHIFFRÉS (AES-256-GCM) avec PFLOW_BOTS_SECRET, pour que le
 * numéro n'apparaisse jamais en clair dans l'adresse. PFlow Order le déchiffre (patch
 * docs/etape-c/patches/04-pre-remplissage.diff, fichier repo/api/bot-contact.js : même format).
 *
 * Format : base64url( iv (12 octets) | texte chiffré | tag (16 octets) ),
 * clé = SHA-256("pflow-bots-contact|" + secret), contenu = JSON { t: numéro, p: prénom, s: slug, e: expiration (s) }.
 * Ce fichier n'importe que node:crypto : il peut être exécuté seul (tests d'interopérabilité).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const CONTACT_TOKEN_TTL_SECONDS = 2 * 3600;

export interface ContactTokenPayload {
  tel: string;
  prenom?: string;
  slug: string;
}

const keyOf = (secret: string) => createHash("sha256").update(`pflow-bots-contact|${secret}`, "utf8").digest();

export function createContactToken(payload: ContactTokenPayload, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = JSON.stringify({ t: payload.tel, p: payload.prenom ?? "", s: payload.slug, e: nowSeconds + CONTACT_TOKEN_TTL_SECONDS });
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
}

/** Null si le jeton est faux, altéré, expiré ou pour un autre resto. */
export function readContactToken(token: string, secret: string, slug: string, nowSeconds = Math.floor(Date.now() / 1000)): ContactTokenPayload | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const json = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"));
    if (json.s !== slug || typeof json.e !== "number" || json.e < nowSeconds || typeof json.t !== "string") return null;
    return { tel: json.t, ...(json.p ? { prenom: json.p } : {}), slug: json.s };
  } catch {
    return null;
  }
}
