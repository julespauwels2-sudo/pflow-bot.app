/** Boîte de réception : les conversations de chaque numéro (resto). */
import { NextResponse } from "next/server";
import { canauxVisibles, idsCanauxPflow, inboxAccess } from "@/channels/core/api-helpers";
import { listInbox } from "@/channels/core/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  const { runtime } = access;
  const canaux = await listInbox(runtime.store, await runtime.workspace(), new Date());
  return NextResponse.json({ available: true, mode: runtime.mode, role: access.role, canaux: canauxVisibles(access.role, canaux, await idsCanauxPflow(runtime)) });
}
