/**
 * Lecture des notifications du webhook Instagram (messagerie des comptes professionnels, Meta).
 * Format « Messenger Platform » : entry[].messaging[] avec sender, recipient, message ou postback.
 * À revérifier dans la documentation de Meta au moment du branchement (C, Instagram).
 */
import type { IncomingMessage } from "@/engine";
import type { InboundEvent, StatusEvent } from "../core/types";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function parseInstagramWebhook(payload: unknown): { inbound: InboundEvent[]; statuses: StatusEvent[] } {
  const inbound: InboundEvent[] = [];
  const statuses: StatusEvent[] = [];
  const body = obj(payload);
  if (str(body.object) !== "instagram") return { inbound, statuses };

  for (const rawEntry of arr(body.entry)) {
    const entry = obj(rawEntry);
    const accountId = str(entry.id);
    for (const raw of arr(entry.messaging)) {
      const m = obj(raw);
      const sender = str(obj(m.sender).id);
      const recipient = str(obj(m.recipient).id);
      const timestamp = str(m.timestamp);
      const account = accountId || recipient;

      // Lu par le client : statut du dernier message envoyé.
      const read = obj(m.read);
      if (str(read.mid)) {
        statuses.push({ plateforme: "instagram", accountId: account, wamid: str(read.mid), statut: "lu" });
        continue;
      }

      // Clic sur un bouton « postback ».
      const postback = obj(m.postback);
      if (str(postback.payload) || str(postback.mid)) {
        const mid = str(postback.mid) || `postback-${sender}-${timestamp}`;
        inbound.push(event(account, sender, mid, timestamp, { kind: "button_reply", id: str(postback.payload), title: str(postback.title) }, "postback", { texte: str(postback.title), reponse: str(postback.payload) }));
        continue;
      }

      const message = obj(m.message);
      const mid = str(message.mid);
      if (!mid) continue;

      // Écho : message envoyé par le compte du resto (appli Instagram ou boîte de réception Meta).
      if (message.is_echo === true) {
        // Nos propres envois reviennent aussi en écho : ils portent l'app_id de PFlow Bots et sont ignorés.
        if (message.app_id) continue;
        const text = str(message.text);
        inbound.push(event(account, recipient, mid, timestamp, { kind: "echo", ...(text ? { text } : {}) }, "echo", { texte: text }));
        continue;
      }

      const quick = obj(message.quick_reply);
      if (str(quick.payload)) {
        const text = str(message.text);
        inbound.push(event(account, sender, mid, timestamp, { kind: "button_reply", id: str(quick.payload), title: text }, "quick_reply", { texte: text, reponse: str(quick.payload) }));
        continue;
      }

      if (str(message.text)) {
        const text = str(message.text);
        inbound.push(event(account, sender, mid, timestamp, { kind: "text", text }, "text", { texte: text }));
        continue;
      }

      const attachment = obj(arr(message.attachments)[0]);
      const type = str(attachment.type) || "inconnu";
      const url = str(obj(attachment.payload).url);
      inbound.push({
        ...event(account, sender, mid, timestamp, { kind: "unsupported", mediaType: type }, type, { type }),
        ...(type === "audio" && url ? { media: { url } } : {}),
        // Réactions, partages de story : notés, sans réponse.
        ...(type === "story_mention" || type === "share" || type === "reel" ? { ignored: true } : {}),
      });
    }
  }
  return { inbound, statuses };
}

function event(accountId: string, waId: string, wamid: string, timestamp: string, message: IncomingMessage, type: string, contenu: unknown): InboundEvent {
  return { plateforme: "instagram", accountId, waId, wamid, timestamp, message, type, contenu };
}
