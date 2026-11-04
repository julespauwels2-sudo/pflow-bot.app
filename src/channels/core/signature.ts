/** Vérification des appels de Meta (signature X-Hub-Signature-256) et du webhook (GET). */
import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

/** Vrai si l'en-tête correspond au corps exact reçu (comparaison en temps constant). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = Buffer.from(signBody(rawBody, appSecret));
  const received = Buffer.from(header.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Vérification de l'adresse par Meta : renvoie le « challenge » si la phrase est la bonne. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const token = params.get("hub.verify_token") ?? "";
  const ok = params.get("hub.mode") === "subscribe" && token.length === verifyToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(verifyToken));
  return ok ? (params.get("hub.challenge") ?? "") : null;
}
