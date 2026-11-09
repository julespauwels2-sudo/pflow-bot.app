/**
 * État du système, réservé aux administrateurs du bot : clés détectées (oui / non, jamais la valeur),
 * canaux configurés, derniers événements reçus et dernières erreurs des webhooks.
 */
import { NextResponse } from "next/server";
import { maskId } from "@/channels/core/privacy";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { checkBotAdmin } from "@/lib/server-auth";
import { channelStatuses, keyStatuses, servicesStatus } from "@/lib/system-status";
import { pushConfigFromEnv } from "@/channels/core/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const canaux = channelStatuses();
  let evenements: { source: string; cle: string; at: string; erreur?: string }[] = [];
  let comptes: { id: string; plateforme: string; etat: string; numero: string; role: string; resto: string; testNumeros: number }[] = [];
  let erreurCanaux: string | undefined;
  /** Les dernières alertes au gérant (transferts) : notification push partie ou non, erreurs, encore ouvertes. */
  let alertes: { at: string; canal: string; source: string; prevenu: boolean; voie: string; push?: string; erreur?: string; ouverte: boolean }[] = [];
  /** Notifications push : clés présentes, appareils abonnés (tous comptes). */
  /** Messages ignorés parce que le canal est en test et l'expéditeur hors de la liste : 4 derniers chiffres seulement. */
  let horsListe: { at: string; fin: string }[] = [];
  const push = { configure: Boolean(pushConfigFromEnv((name) => process.env[name]?.trim() || "")), appareils: 0 };
  if (canaux.some((c) => c.configure)) {
    try {
      const rt = await getChannelsRuntime();
      const [events, list] = await Promise.all([rt.store.recentEvents(30), rt.store.listCanaux()]);
      // Identifiants masqués : ces clés contiennent parfois un numéro.
      evenements = events.map((e) => ({ source: e.source, cle: maskId(e.key), at: e.at, ...(e.error ? { erreur: maskId(e.error) } : {}) }));
      const names = new Map((await rt.workspace().catch(() => ({ clients: [] as { id: string; nomResto: string }[] }))).clients.map((c) => [c.id, c.nomResto]));
      comptes = list.map((c) => ({
        id: c.id,
        plateforme: c.plateforme,
        etat: c.etat,
        numero: c.numeroAffiche ?? c.accountId,
        role: c.role ?? "resto",
        resto: c.role === "pflow" ? "Numéro PFlow (démos)" : (names.get(c.restaurantId) ?? "?"),
        testNumeros: c.testNumeros.length,
      }));
      const transferts = (await Promise.all(list.map(async (c) => (await rt.store.listTransferts(c.id)).map((t) => ({ t, canal: c.numeroAffiche ?? c.id }))))).flat();
      alertes = transferts
        .sort((a, b) => b.t.at.localeCompare(a.t.at))
        .slice(0, 20)
        .map(({ t, canal }) => ({
          at: t.at,
          canal,
          source: t.source,
          prevenu: t.gerantPrevenu,
          // Voie : « push » ou « aucune » ; les anciennes alertes (WhatsApp, e-mail) gardent leur voie d'origine.
          voie: t.alertePush ? (t.alertePush === "envoyee" ? "push" : "aucune") : (t.alerteVoie ?? (t.gerantPrevenu ? "ancienne" : "aucune")),
          ...(t.alertePush ? { push: t.alertePush } : {}),
          ouverte: !t.resoluLe,
          ...(t.alerteErreur ? { erreur: maskId(t.alerteErreur) } : {}),
        }));
      push.appareils = (await rt.store.listPushSubscriptions().catch(() => [])).length;
      horsListe = (await rt.store.recentEvents(200))
        .filter((e) => e.key.includes("hors-liste:"))
        .flatMap((e) => {
          const fin = /…(\d{4})\)/.exec(e.error ?? "")?.[1];
          return fin ? [{ at: e.at, fin }] : [];
        })
        .slice(0, 20);
    } catch (error) {
      erreurCanaux = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json(
    { cles: keyStatuses(), canaux, services: servicesStatus(), comptes, evenements, alertes, push, horsListe, ...(erreurCanaux ? { erreurCanaux } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}
