/**
 * Lecture simple de l'intention d'un message libre (sans IA) : salutation, longueur, question.
 * Sert à choisir entre le flux par défaut (Accueil), un flux par mot-clé et l'IA.
 */
import { normalize } from "./match";

/** Au-delà de ce nombre de mots, un mot-clé isolé ne lance plus son flux : c'est une phrase, l'IA répond. */
export const KEYWORD_MAX_WORDS = 4;

/** Une conversation est « nouvelle » quand le contact n'a pas écrit depuis ce délai (accueil complet). */
export const NEW_CONVERSATION_HOURS = 12;

/** Mots d'une salutation (français, anglais, créole), avec les politesses qui les accompagnent. */
const GREETING_WORDS = new Set([
  "bonjour", "bonsoir", "bonjou", "bonswa", "salut", "slt", "bjr", "bsr", "hello", "hi", "hey", "coucou", "cc",
  "yo", "wesh", "allo", "re", "bonne", "journee", "soiree", "sa", "ka", "fet", "ca", "va", "comment", "madame",
  "monsieur", "mme", "mr", "la", "l", "equipe", "a", "tous", "vous", "toi", "svp", "stp",
]);

/** Mots qui, seuls, en font une salutation (« ça va » ou « madame » seuls n'en sont pas). */
const GREETING_CORE = new Set(["bonjour", "bonsoir", "bonjou", "bonswa", "salut", "slt", "bjr", "bsr", "hello", "hi", "hey", "coucou", "cc", "yo", "wesh", "allo"]);

export const words = (text: string): string[] => normalize(text).split(" ").filter(Boolean);

/** « Bonjour », « Salut ça va ? », « Bonsoir madame » : rien d'autre qu'une salutation. */
export function isGreeting(text: string): boolean {
  const list = words(text);
  return list.length > 0 && list.some((w) => GREETING_CORE.has(w)) && list.every((w) => GREETING_WORDS.has(w));
}

/** Message assez court pour qu'un mot-clé exprime l'intention (« je veux commander », « horaires ? »). */
export function isShortMessage(text: string, max = KEYWORD_MAX_WORDS): boolean {
  return words(text).length <= max;
}

/** Nouvelle conversation : premier message du contact, ou rien reçu de lui depuis NEW_CONVERSATION_HOURS. */
export function isNewConversation(previousInboundAt: string | undefined, now: Date, hours = NEW_CONVERSATION_HOURS): boolean {
  if (!previousInboundAt) return true;
  const last = Date.parse(previousInboundAt);
  return !Number.isFinite(last) || now.getTime() - last >= hours * 3_600_000;
}
