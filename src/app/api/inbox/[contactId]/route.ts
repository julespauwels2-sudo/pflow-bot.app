/** Une conversation : ses messages (GET) et les actions de la personne (POST). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { idsCanauxPflow, inboxAccess, type InboxAccess } from "@/channels/core/api-helpers";
import { applyInboxAction, InboxError, messageText } from "@/channels/core/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ contactId: string }> };

/** Un examinateur n'ouvre que les conversations du numéro PFlow (démos) ; les autres : « introuvable ». */
async function contactVisible(access: Extract<InboxAccess, { ok: true }>, contactId: string) {
  const contact = await access.runtime.store.getContact(contactId);
  if (!contact) return null;
  if (access.role === "admin") return contact;
  return (await idsCanauxPflow(access.runtime)).has(contact.canalId) ? contact : null;
}

export async function GET(request: Request, { params }: Params) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  const { contactId } = await params;
  const { store } = access.runtime;
  const contact = await contactVisible(access, contactId);
  if (!contact) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
  const messages = await store.listMessages(contactId, 200);
  return NextResponse.json({ contact, messages: messages.map((m) => ({ ...m, texte: messageText(m) })) });
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reprendre") }),
  z.object({ type: z.literal("relancer") }),
  z.object({ type: z.literal("repondre"), texte: z.string().max(4096) }),
]);

export async function POST(request: Request, { params }: Params) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  const { contactId } = await params;
  if (!(await contactVisible(access, contactId))) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  try {
    await applyInboxAction({ store: access.runtime.store, senders: access.runtime.senders, now: new Date() }, contactId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof InboxError ? 400 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
