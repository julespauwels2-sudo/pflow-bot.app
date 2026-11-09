/** Accès commun des routes /api/push : administrateur connecté, limite de débit, stockage des abonnements. */
import { NextResponse } from "next/server";
import { getChannelsRuntime, type ChannelsRuntime } from "@/channels/core/runtime";
import { checkBotAdmin } from "./server-auth";
import { tooManyRequests } from "./request-limit";

/** Plafond d'appareils par compte (un iPhone, un ordinateur… et de la marge pour les réinstallations). */
export const MAX_PUSH_DEVICES = 10;

type Access = { ok: true; userId: string; store: ChannelsRuntime["store"] } | { ok: false; response: NextResponse };

/** Administrateur connecté + stockage. Sans Supabase (tests locaux, mode mémoire) : compte « local ». */
export async function pushAccess(request: Request, scope: string, max: number): Promise<Access> {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const limited = tooManyRequests(scope, request, caller.userId, max);
  if (limited) return { ok: false, response: limited };
  try {
    const rt = await getChannelsRuntime();
    if (rt.mode === "supabase" && !caller.userId) {
      return { ok: false, response: NextResponse.json({ error: "Connexion Supabase requise pour les notifications." }, { status: 400 }) };
    }
    return { ok: true, userId: caller.userId ?? "local", store: rt.store };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}

