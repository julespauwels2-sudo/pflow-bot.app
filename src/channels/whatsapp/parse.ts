/**
 * Lecture des notifications du webhook WhatsApp Cloud (Meta) → messages du moteur.
 * Champs pris en charge : « messages » (messages des clients et statuts d'envoi) et, pour la
 * coexistence, « smb_message_echoes » (messages envoyés par le gérant depuis l'appli WhatsApp Business).
 * Format de l'écho à revérifier dans la documentation de Meta au moment de C6.
 */
import type { IncomingMessage } from "@/engine";
import type { InboundEvent, MediaRef, StatusEvent } from "../core/types";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Message WhatsApp → message du moteur. */
export function toIncoming(m: Json): { message: IncomingMessage; ignored?: boolean; contenu: unknown; media?: MediaRef } {
  const type = str(m.type);
  // Message vocal (ou fichier audio) : transcrit si un service est configuré (tâche 6).
  if (type === "audio") {
    const a = obj(m.audio);
    return {
      message: { kind: "unsupported", mediaType: "audio" },
      contenu: { type, ...(a.voice === true ? { vocal: true } : {}) },
      ...(str(a.id) ? { media: { id: str(a.id), ...(str(a.mime_type) ? { mimeType: str(a.mime_type) } : {}) } } : {}),
    };
  }
  if (type === "text") {
    const body = str(obj(m.text).body);
    return { message: { kind: "text", text: body }, contenu: { texte: body } };
  }
  if (type === "interactive") {
    const i = obj(m.interactive);
    if (str(i.type) === "button_reply") {
      const r = obj(i.button_reply);
      return { message: { kind: "button_reply", id: str(r.id), title: str(r.title) }, contenu: { texte: str(r.title), reponse: str(r.id) } };
    }
    if (str(i.type) === "list_reply") {
      const r = obj(i.list_reply);
      return { message: { kind: "list_reply", id: str(r.id), title: str(r.title) }, contenu: { texte: str(r.title), reponse: str(r.id) } };
    }
  }
  // Bouton d'un modèle (template) : traité comme du texte.
  if (type === "button") {
    const text = str(obj(m.button).text);
    return { message: { kind: "text", text }, contenu: { texte: text } };
  }
  // Réactions et messages système : notés, sans réponse.
  if (type === "reaction" || type === "system" || type === "unsupported" || type === "") {
    return { message: { kind: "unsupported", mediaType: type || "inconnu" }, ignored: true, contenu: { type } };
  }
  return { message: { kind: "unsupported", mediaType: type }, contenu: { type } };
}

export function parseWebhook(payload: unknown): { inbound: InboundEvent[]; statuses: StatusEvent[] } {
  const inbound: InboundEvent[] = [];
  const statuses: StatusEvent[] = [];
  const body = obj(payload);
  if (str(body.object) !== "whatsapp_business_account") return { inbound, statuses };

  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      const value = obj(c.value);
      const accountId = str(obj(value.metadata).phone_number_id);
      if (!accountId) continue;
      const names = new Map(arr(value.contacts).map((x) => [str(obj(x).wa_id), str(obj(obj(x).profile).name)]));

      if (str(c.field) === "messages") {
        for (const raw of arr(value.messages)) {
          const m = obj(raw);
          const waId = str(m.from);
          const wamid = str(m.id);
          if (!waId || !wamid) continue;
          const parsed = toIncoming(m);
          inbound.push({
            plateforme: "whatsapp",
            accountId,
            waId,
            profileName: names.get(waId) || undefined,
            wamid,
            timestamp: str(m.timestamp),
            message: parsed.message,
            ignored: parsed.ignored,
            type: str(m.type) || "inconnu",
            contenu: parsed.contenu,
            ...(parsed.media ? { media: parsed.media } : {}),
          });
        }
        for (const raw of arr(value.statuses)) {
          const s = obj(raw);
          const map: Record<string, StatusEvent["statut"]> = { sent: "envoye", delivered: "delivre", read: "lu", failed: "echec" };
          const statut = map[str(s.status)];
          if (!statut || !str(s.id)) continue;
          const error = obj(arr(s.errors)[0]);
          statuses.push({ plateforme: "whatsapp", accountId, wamid: str(s.id), statut, ...(statut === "echec" ? { erreur: str(error.title) || str(error.message) || "Échec d'envoi" } : {}) });
        }
      }

      // Coexistence : le gérant a écrit depuis son appli WhatsApp Business.
      if (str(c.field) === "smb_message_echoes") {
        for (const raw of arr(value.message_echoes)) {
          const m = obj(raw);
          const waId = str(m.to);
          const wamid = str(m.id);
          if (!waId || !wamid) continue;
          const text = str(obj(m.text).body);
          inbound.push({
            plateforme: "whatsapp",
            accountId,
            waId,
            wamid,
            timestamp: str(m.timestamp),
            message: { kind: "echo", ...(text ? { text } : {}) },
            type: str(m.type) || "echo",
            contenu: { texte: text },
          });
        }
      }
    }
  }
  return { inbound, statuses };
}
