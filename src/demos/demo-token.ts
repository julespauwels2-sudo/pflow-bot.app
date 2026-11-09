/**
 * Jeton de la démo permanente (numéro PFlow Démo) : il accompagne les liens [Je commande] et [Voir le dashboard]
 * envoyés à UN contact. Il permet seulement d'écrire à ce contact-là, sur ce canal-là, pendant 24 h :
 * - la page de commande de démo l'envoie avec la commande validée (POST /api/demo/commande) ;
 * - le lien du dashboard passe par GET /api/demo/dashboard/<jeton>, qui programme l'étape 3.
 *
 * CHIFFRÉ (AES-256-GCM, même méthode que contact-token.ts) avec PFLOW_BOTS_SECRET : ni le numéro ni l'id du
 * contact n'apparaissent en clair dans l'adresse ; un jeton modifié est refusé.
 * Format : base64url( iv (12) | chiffré | tag (16) ), clé = SHA-256("pflow-bots-demo|" + secret),
 * contenu = JSON { c: id du contact, k: id du canal, e: expiration (s) }.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const DEMO_TOKEN_TTL_SECONDS = 24 * 3600;
/** Longueur maximale acceptée (un vrai jeton fait ~110 caractères). */
export const DEMO_TOKEN_MAX_LENGTH = 400;

export interface DemoTokenPayload {
  contactId: string;
  canalId: string;
}

const keyOf = (secret: string) => createHash("sha256").update(`pflow-bots-demo|${secret}`, "utf8").digest();

export function createDemoToken(payload: DemoTokenPayload, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = JSON.stringify({ c: payload.contactId, k: payload.canalId, e: nowSeconds + DEMO_TOKEN_TTL_SECONDS });
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
}

/** Null si le jeton est faux, altéré ou expiré. */
export function readDemoToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): DemoTokenPayload | null {
  try {
    if (!token || token.length > DEMO_TOKEN_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const json = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"));
    if (typeof json.c !== "string" || typeof json.k !== "string" || typeof json.e !== "number" || json.e < nowSeconds) return null;
    return { contactId: json.c, canalId: json.k };
  } catch {
    return null;
  }
}
