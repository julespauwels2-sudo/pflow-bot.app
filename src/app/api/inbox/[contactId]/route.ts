/** Une conversation : ses messages (GET) et les actions de la personne (POST). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { canauxPermis, idsCanauxVisibles, inboxAccess, type InboxAccess } from "@/channels/core/api-helpers";
import { applyInboxAction, InboxError, InboxSendError, messageText } from "@/channels/core/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ contactId: string }> };

/** Un examinateur n'ouvre que les conversations du numéro PFlow (démos), un resto que celles de ses numéros ; les autres : « introuvable ». */
async function contactVisible(access: Extract<InboxAccess, { ok: true }>, contactId: string) {
  const contact = await access.runtime.store.getContact(contactId);
  if (!contact) return null;
  if (access.role === "admin") return contact;
  return (await idsCanauxVisibles(access)).has(contact.canalId) ? contact : null;
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
  z.object({ type: z.literal("lu"), at: z.string().datetime({ offset: true }) }),
]);

/**
 * Répondre : renvoie seulement le message enregistré (son id réel remplace l'id provisoire de l'écran) et la pause du
 * bot ; l'écran n'a pas à recharger la conversation ni la liste. Échec de Meta : 502 avec la tentative enregistrée.
 */
export async function POST(request: Request, { params }: Params) {
  const access = await inboxAccess(request);
  if (!access.ok) return access.response;
  const { contactId } = await params;
  const { store } = access.runtime;
  // Contact et numéros lus en même temps (une seule attente), puis transmis à l'action (pas relus).
  const [contact, canaux] = await Promise.all([store.getContact(contactId), store.listCanaux()]);
  const visible = contact && (access.role === "admin" || canauxPermis(canaux, access).has(contact.canalId));
  if (!contact || !visible) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  // Conversation lue sur cet appareil : enregistrée pour l'utilisateur (non-lus synchronisés entre appareils).
  if (parsed.data.type === "lu") {
    return NextResponse.json({ ok: await store.markLu(access.userId, contactId, new Date(parsed.data.at).toISOString()) });
  }
  try {
    const result = await applyInboxAction({ store, senders: access.runtime.senders, now: new Date(), contact, canaux }, contactId, parsed.data);
    return NextResponse.json({
      ok: true,
      pause: result.pause,
      ...(result.message ? { message: { ...result.message, texte: messageText(result.message) } } : {}),
    });
  } catch (error) {
    if (error instanceof InboxSendError) {
      return NextResponse.json({ error: error.message, message: { ...error.stored, texte: messageText(error.stored) } }, { status: 502 });
    }
    const status = error instanceof InboxError ? 400 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
