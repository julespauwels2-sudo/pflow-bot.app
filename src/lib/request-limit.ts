/** Limite de débit des routes de l'interface (par compte connecté, sinon par adresse). */
import { NextResponse } from "next/server";
import { rateLimit } from "@/channels/core/rate-limit";

export function clientKey(request: Request, userId: string | null): string {
  return userId ?? `ip:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue"}`;
}

/** Réponse 429 si la limite est dépassée, sinon null. */
export function tooManyRequests(scope: string, request: Request, userId: string | null, max: number, windowMs = 60_000): NextResponse | null {
  if (rateLimit(`${scope}:${clientKey(request, userId)}`, max, windowMs)) return null;
  return NextResponse.json({ error: "Trop de demandes en peu de temps : réessaie dans une minute." }, { status: 429, headers: { "retry-after": "60" } });
}
