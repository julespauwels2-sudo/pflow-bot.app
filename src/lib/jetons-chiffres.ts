/**
 * Chiffrement des jetons Meta des clients (table bot_jetons_whatsapp) : AES-256-GCM, côté serveur seulement.
 * Clé : variable BOT_JETONS_CLE (32 octets en base64, `openssl rand -base64 32`), dans Vercel, jamais en base ni dans
 * Git. Format stocké : « v1:<iv>:<tag>:<chiffré> » (base64). Un jeton modifié ou une mauvaise clé : erreur, jamais de
 * texte faux.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class CleJetonsError extends Error {}

export function cleJetons(env: string | undefined = process.env.BOT_JETONS_CLE): Buffer {
  const raw = env?.trim();
  if (!raw) throw new CleJetonsError("BOT_JETONS_CLE absente : impossible de garder le jeton du client (variable Vercel à ajouter).");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new CleJetonsError("BOT_JETONS_CLE invalide : 32 octets en base64 attendus (openssl rand -base64 32).");
  return key;
}

export function chiffrerJeton(jeton: string, key: Buffer = cleJetons()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(jeton, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function dechiffrerJeton(stocke: string, key: Buffer = cleJetons()): string {
  const [v, iv, tag, data] = stocke.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new CleJetonsError("Jeton chiffré illisible");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
