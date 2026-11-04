/**
 * Mode démo (stockage en mémoire uniquement) : simule un message d'un client, comme s'il arrivait de
 * Meta, pour tester la boîte de réception sans numéro WhatsApp. Refusé avec le vrai stockage.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { inboxAccess } from "@/channels/whatsapp/api-helpers";
import { processWebhookPayload } from "@/channels/whatsapp/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ texte: z.string().min(1).max(1000), waId: z.string().regex(/^\d{6,15}$/).default("590690000001"), nom: z.string().max(60).default("Client test") });

export async function POST(request: Request) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  if (access.runtime.mode !== "memory") return NextResponse.json({ error: "Simulation réservée au mode démo (stockage en mémoire)." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Message invalide" }, { status: 400 });
  const [canal] = await access.runtime.store.listCanaux();
  if (!canal) return NextResponse.json({ error: "Aucun canal" }, { status: 400 });
  const { texte, waId, nom } = parsed.data;
  const report = await processWebhookPayload(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: canal.phoneNumberId },
                contacts: [{ wa_id: waId, profile: { name: nom } }],
                messages: [{ from: waId, id: `wamid.simu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texte } }],
              },
            },
          ],
        },
      ],
    },
    access.runtime.deps,
  );
  return NextResponse.json({ ok: true, report });
}
