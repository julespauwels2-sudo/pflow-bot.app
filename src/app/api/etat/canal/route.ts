/**
 * État d'un canal (page État), réservé aux administrateurs du bot : test, actif ou coupé.
 * - « actif » : le bot répond à tout le monde, et PFlow Order lui envoie les événements des vraies
 *   commandes du resto (au lieu d'UChat). Jamais pour un numéro de test Meta (+1 555…) : les vraies
 *   commandes partiraient vers un numéro que les clients ne connaissent pas.
 * - « test » : seulement les numéros de test ; les vraies commandes restent à UChat (retour arrière).
 * - « coupé » : le bot ne répond plus du tout sur ce numéro.
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime } from "@/channels/core/runtime";
import { checkBotAdmin } from "@/lib/server-auth";
import { isMetaTestNumber } from "@/channels/core/canal-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const body = (await request.json().catch(() => ({}))) as { id?: string; etat?: string };
  if (!body.id || !["test", "actif", "coupe"].includes(body.etat ?? "")) return NextResponse.json({ error: "Demande invalide." }, { status: 400 });
  const { store } = await getChannelsRuntime();
  const canal = (await store.listCanaux()).find((c) => c.id === body.id);
  if (!canal) return NextResponse.json({ error: "Canal introuvable." }, { status: 404 });
  if (body.etat === "actif" && isMetaTestNumber(canal.numeroAffiche)) {
    return NextResponse.json({ error: "Numéro de test Meta : il ne passe jamais en « actif » (les vraies commandes du resto partiraient vers ce numéro)." }, { status: 400 });
  }
  await store.setCanalEtat(canal.id, body.etat as "test" | "actif" | "coupe");
  console.log(`[canal] ${canal.numeroAffiche ?? canal.accountId} : ${canal.etat} → ${body.etat}`);
  return NextResponse.json({ ok: true, etat: body.etat });
}
