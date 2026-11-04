/**
 * Mode démo (stockage en mémoire uniquement) : simule un message d'un client, comme s'il arrivait de
 * Meta, pour tester la boîte de réception sans numéro ni compte. Refusé avec le vrai stockage.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { inboxAccess } from "@/channels/core/api-helpers";
import { processEvents } from "@/channels/core/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  texte: z.string().min(1).max(1000),
  plateforme: z.enum(["whatsapp", "instagram"]).default("whatsapp"),
  waId: z.string().regex(/^\d{6,20}$/).optional(),
  nom: z.string().max(60).default("Client test"),
});

export async function POST(request: Request) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  if (access.runtime.mode !== "memory") return NextResponse.json({ error: "Simulation réservée au mode démo (stockage en mémoire)." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message invalide" }, { status: 400 });
  const { texte, plateforme, nom } = parsed.data;
  const deps = access.runtime.deps(plateforme);
  if (!deps) return NextResponse.json({ error: `${plateforme} non configuré (variables manquantes)` }, { status: 400 });
  const canal = (await access.runtime.store.listCanaux()).find((c) => c.plateforme === plateforme);
  if (!canal) return NextResponse.json({ error: "Aucun canal" }, { status: 400 });
  const waId = parsed.data.waId ?? (plateforme === "instagram" ? "6000000000001" : "590690000001");
  const report = await processEvents(
    {
      inbound: [
        {
          plateforme,
          accountId: canal.accountId,
          waId,
          profileName: nom,
          wamid: `simu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          message: { kind: "text", text: texte },
          type: "text",
          contenu: { texte },
        },
      ],
      statuses: [],
    },
    deps,
  );
  return NextResponse.json({ ok: true, report });
}
