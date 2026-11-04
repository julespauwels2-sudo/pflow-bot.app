/**
 * Garde-fous sur le texte écrit par l'IA, appliqués avant tout envoi au client :
 * - aucun lien : le client reçoit toujours le bouton natif (voir le moteur, proposer_commande) ;
 * - pas de nouvelle salutation en tête de réponse : l'Accueil a déjà salué le client.
 */

/** [texte](url) au format Markdown : on garde le texte. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * Adresses web : avec protocole, avec « www. », ou domaine suivi d'un chemin
 * (ex. order.pflow.fr/c/mon-resto). Toute mention de pflow.fr est aussi retirée.
 */
const URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"'()]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s<>"'()]*|\b(?:[a-z0-9-]+\.)*pflow\.fr\b/gi;

/** Salutation seule sur la première ligne : « Bonjour ! », « Bonjour Léa 😊 », « Hello, » … */
const GREETING_LINE =
  /^\s*(?:re-?)?(?:bonjour|bonsoir|salut|hello|coucou|hey|bienvenue)(?:\s+[\p{L}'’-]+){0,2}\s*[!,.…]*\s*(?:\p{Extended_Pictographic}️?\s*)*$/iu;

export interface CleanedAiText {
  text: string;
  /** Liens retirés (vide si aucun). */
  removedLinks: string[];
  /** Vrai si une salutation de début a été retirée. */
  removedGreeting: boolean;
}

/** Retire les liens et nettoie ce qui les entourait (« 👉 », « : » en fin de ligne, lignes vides). */
export function stripLinks(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let out = text.replace(MARKDOWN_LINK, (_m, label: string, url: string) => {
    removed.push(url);
    return label;
  });
  out = out.replace(URL_PATTERN, (url) => {
    removed.push(url.replace(/[.,;:!?]+$/, ""));
    // La ponctuation finale collée au lien appartient à la phrase.
    return /[.!?]$/.test(url) ? url.slice(-1) : "";
  });
  if (!removed.length) return { text, removed };
  out = out
    .split("\n")
    .map((line) =>
      line
        .replace(/\(\s*\)/g, "")
        .replace(/\s*(?:👉|➡️|➡|👇|🔗|→)\s*(?=[.!?]?\s*$)/gu, "")
        .replace(/\s*[:：\-–—]\s*(?=[.!?]?\s*$)/u, "")
        .replace(/\s+\.\s*$/, ".")
        .replace(/\s+([!?])\s*$/, " $1")
        .replace(/[ \t]+$/, ""),
    )
    .filter((line, i, lines) => !/^\s*[.!?:]*\s*$/.test(line) || (line === "" && lines[i - 1] !== ""))
    .join("\n")
    .trim();
  return { text: out, removed };
}

/** Retire une ligne de salutation en tête de réponse, s'il reste quelque chose après. */
export function stripGreeting(text: string): { text: string; removed: boolean } {
  const lines = text.split("\n");
  if (!GREETING_LINE.test(lines[0] ?? "")) return { text, removed: false };
  const rest = lines.slice(1).join("\n").trim();
  return rest ? { text: rest, removed: true } : { text, removed: false };
}

export function cleanAiText(text: string): CleanedAiText {
  const links = stripLinks(text);
  const greeting = stripGreeting(links.text);
  return { text: greeting.text, removedLinks: links.removed, removedGreeting: greeting.removed };
}
