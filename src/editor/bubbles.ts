/**
 * Opérations sur les bulles d'un bloc Message. C'est ici que les règles WhatsApp sont
 * imposées à la saisie : une bulle porte soit 1 à 3 boutons de réponse, soit 1 bouton lien.
 */
import type { BubbleButton, MessageBubble, NodeDataMap } from "@/engine";
import { MAX_BUBBLES, shortId } from "./catalog";
import { WA_LIMITS } from "./limits";

type MessageData = NodeDataMap["message"];

export interface AddButtonOption {
  allowed: boolean;
  /** Raison affichée quand le choix est grisé. */
  reason?: string;
}

export function canAddReply(bubble: MessageBubble): AddButtonOption {
  if (bubble.buttons.some((b) => b.kind === "link")) {
    return { allowed: false, reason: "Cette bulle a déjà un bouton lien : WhatsApp ne mélange pas les deux." };
  }
  if (bubble.buttons.length >= WA_LIMITS.buttonsMax) {
    return { allowed: false, reason: `WhatsApp limite à ${WA_LIMITS.buttonsMax} boutons de réponse par bulle.` };
  }
  return { allowed: true };
}

export function canAddLink(bubble: MessageBubble): AddButtonOption {
  if (bubble.buttons.some((b) => b.kind === "link")) {
    return { allowed: false, reason: "Un seul bouton lien par bulle (règle WhatsApp)." };
  }
  if (bubble.buttons.some((b) => b.kind === "reply")) {
    return { allowed: false, reason: "Cette bulle a déjà des boutons de réponse : WhatsApp ne mélange pas les deux." };
  }
  return { allowed: true };
}

export const canAddBubble = (data: MessageData) => data.bubbles.length < MAX_BUBBLES;

function mapBubble(data: MessageData, bubbleId: string, fn: (b: MessageBubble) => MessageBubble): MessageData {
  return { ...data, bubbles: data.bubbles.map((b) => (b.id === bubbleId ? fn(b) : b)) };
}

export function addReplyButton(data: MessageData, bubbleId: string): MessageData {
  const bubble = data.bubbles.find((b) => b.id === bubbleId);
  if (!bubble || !canAddReply(bubble).allowed) return data;
  const n = data.bubbles.flatMap((b) => b.buttons).filter((b) => b.kind === "reply").length + 1;
  return mapBubble(data, bubbleId, (b) => ({ ...b, buttons: [...b.buttons, { id: `r${shortId()}`, kind: "reply", title: `Option ${n}` }] }));
}

/** Ajoute un bouton lien ; par défaut, le lien de commande du client. */
export function addLinkButton(data: MessageData, bubbleId: string, orderLink = true): MessageData {
  const bubble = data.bubbles.find((b) => b.id === bubbleId);
  if (!bubble || !canAddLink(bubble).allowed) return data;
  const button: BubbleButton = orderLink
    ? { id: `l${shortId()}`, kind: "link", title: "Commander", orderLink: true }
    : { id: `l${shortId()}`, kind: "link", title: "Ouvrir", url: "https://" };
  return mapBubble(data, bubbleId, (b) => ({ ...b, buttons: [...b.buttons, button] }));
}

export function updateButton(data: MessageData, bubbleId: string, button: BubbleButton): MessageData {
  return mapBubble(data, bubbleId, (b) => ({ ...b, buttons: b.buttons.map((x) => (x.id === button.id ? button : x)) }));
}

export function removeButton(data: MessageData, bubbleId: string, buttonId: string): MessageData {
  return mapBubble(data, bubbleId, (b) => ({ ...b, buttons: b.buttons.filter((x) => x.id !== buttonId) }));
}

export function setBubbleText(data: MessageData, bubbleId: string, text: string): MessageData {
  return mapBubble(data, bubbleId, (b) => ({ ...b, text }));
}

export function addBubble(data: MessageData): MessageData {
  if (!canAddBubble(data)) return data;
  return { ...data, bubbles: [...data.bubbles, { id: `bu${shortId()}`, text: "", buttons: [] }] };
}

/** Supprime une bulle (il en reste toujours au moins une). */
export function removeBubble(data: MessageData, bubbleId: string): MessageData {
  if (data.bubbles.length <= 1) return data;
  return { ...data, bubbles: data.bubbles.filter((b) => b.id !== bubbleId) };
}

export function moveBubble(data: MessageData, bubbleId: string, delta: -1 | 1): MessageData {
  const i = data.bubbles.findIndex((b) => b.id === bubbleId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= data.bubbles.length) return data;
  const bubbles = [...data.bubbles];
  [bubbles[i], bubbles[j]] = [bubbles[j], bubbles[i]];
  return { ...data, bubbles };
}
