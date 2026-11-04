/**
 * État du système, réservé aux administrateurs du bot : clés détectées (oui / non, jamais la valeur),
 * canaux configurés, derniers événements reçus et dernières erreurs des webhooks.
 */
import { NextResponse } from "next/server";
import { maskId } from "@/channels/core/privacy";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { checkBotAdmin } from "@/lib/server-auth";
import { channelStatuses, keyStatuses, servicesStatus } from "@/lib/system-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const canaux = channelStatuses();
  let evenements: { source: string; cle: string; at: string; erreur?: string }[] = [];
  let comptes: { plateforme: string; etat: string }[] = [];
  let erreurCanaux: string | undefined;
  if (canaux.some((c) => c.configure)) {
    try {
      const rt = await getChannelsRuntime();
      const [events, list] = await Promise.all([rt.store.recentEvents(30), rt.store.listCanaux()]);
      // Identifiants masqués : ces clés contiennent parfois un numéro.
      evenements = events.map((e) => ({ source: e.source, cle: maskId(e.key), at: e.at, ...(e.error ? { erreur: maskId(e.error) } : {}) }));
      comptes = list.map((c) => ({ plateforme: c.plateforme, etat: c.etat }));
    } catch (error) {
      erreurCanaux = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json(
    { cles: keyStatuses(), canaux, services: servicesStatus(), comptes, evenements, ...(erreurCanaux ? { erreurCanaux } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}
