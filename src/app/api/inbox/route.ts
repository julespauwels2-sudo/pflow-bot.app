/** Boîte de réception : les conversations de chaque numéro (resto). */
import { NextResponse } from "next/server";
import { canauxVisibles, idsCanauxVisibles, inboxAccess } from "@/channels/core/api-helpers";
import { listInbox } from "@/channels/core/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  const { runtime } = access;
  // Recherche (nom, numéro ou contenu d'un message) : 100 caractères au plus.
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
  let lectures = false;
  // Données des bots, numéros et conversations lus en même temps (plus de lectures à la file).
  const [canaux, permis] = await Promise.all([
    listInbox(runtime.store, runtime.workspace(), new Date(), { q, userId: access.userId, onLectures: (a) => (lectures = a) }),
    idsCanauxVisibles(access),
  ]);
  return NextResponse.json({ available: true, mode: runtime.mode, role: access.role, lectures, canaux: canauxVisibles(access.role, canaux, permis) });
}
