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

/** Au-delà, même une phrase qui commence par un mot-clé reste ignorée en mode mots-clés (vrai texte perso). */
export const SENTENCE_MAX_WORDS = 20;

/**
 * Mot-clé dans une phrase (mode « mots-clés uniquement », numéro aussi utilisé par le gérant pour ses conversations) :
 * - la phrase COMMENCE par un mot-clé (« Commande pour ce soir svp », « Menu ? ») ;
 * - ou elle commence par une salutation ET contient un mot-clé qui n'est pas une salutation (« Bonjour, je viens de
 *   passer la commande », « Bonsoir c'est quoi vos horaires »).
 * Jamais pour une simple conversation (« Salut tu viens ce soir ? » : aucun mot-clé hors salutation). 20 mots au plus.
 * Le mot-clé le plus long gagne, puis le flux par défaut.
 */
export function keywordInSentence(
  flows: { trigger: { keywords: string[]; isDefault?: boolean; event?: string; matchMode?: "contient" | "exact" } | undefined; id: string }[],
  text: string,
): { id: string; keyword: string } | undefined {
  const list = words(text);
  if (!list.length || list.length > SENTENCE_MAX_WORDS) return undefined;
  const msg = list.join(" ");
  const greetingLed = GREETING_CORE.has(list[0]!);
  let best: { id: string; keyword: string; length: number; isDefault: boolean } | undefined;
  for (const flow of flows) {
    const t = flow.trigger;
    if (!t || t.event || t.matchMode === "exact") continue;
    for (const keyword of t.keywords) {
      const kw = normalize(keyword);
      if (!kw) continue;
      const starts = msg === kw || msg.startsWith(`${kw} `);
      const isGreetingKeyword = kw.split(" ").every((w) => GREETING_WORDS.has(w));
      const inside = greetingLed && !isGreetingKeyword && ` ${msg} `.includes(` ${kw} `);
      if (!starts && !inside) continue;
      // Une salutation seule en tête ne suffit pas : il faut un vrai mot-clé (« commande », « horaires »…).
      if (starts && isGreetingKeyword && list.length > KEYWORD_MAX_WORDS) continue;
      const isDefault = Boolean(t.isDefault);
      if (!best || kw.length > best.length || (kw.length === best.length && isDefault && !best.isDefault)) best = { id: flow.id, keyword, length: kw.length, isDefault };
    }
  }
  return best && { id: best.id, keyword: best.keyword };
}

const QUESTION_WORDS = new Set(["ou", "quand", "comment", "combien", "quoi", "quel", "quelle", "quels", "quelles", "pourquoi", "est"]);

/** « ma commande est où ? », « c'est quand la commande ? » : une question (point d'interrogation ou mot interrogatif). */
export function isQuestion(text: string): boolean {
  return text.includes("?") || words(text).some((w) => QUESTION_WORDS.has(w));
}

/** Mot-clé fait uniquement de salutations (« bonjour », « coucou ») : jamais une question à confier à l'IA. */
export function isGreetingKeyword(keyword: string): boolean {
  const list = words(keyword);
  return list.length > 0 && list.every((w) => GREETING_WORDS.has(w));
}
