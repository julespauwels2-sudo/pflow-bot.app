const VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const HAS_VARIABLE = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/;
/** Ligne qui ne contient que des variables (ex. « {{points_de_vente}} »). */
const VARIABLE_ONLY_LINE = /^\s*(?:\{\{\s*[a-zA-Z0-9_]+\s*\}\}\s*)+$/;

const substitute = (text: string, vars: Record<string, string | undefined>) => text.replace(VARIABLE, (_, name: string) => vars[name] ?? "");

/**
 * Retire ce qui annoncerait une info vide. Dans chaque paragraphe (séparé par une ligne vide) :
 * - une ligne faite uniquement de variables vides disparaît ;
 * - si toutes ces lignes sont vides et qu'il ne reste qu'un titre (ex. « 🏪 *Points de vente* »),
 *   le paragraphe entier disparaît.
 * Une phrase qui contient une variable (« Bonjour {{prenom}} ! ») n'est jamais retirée.
 */
function dropEmptySections(text: string, vars: Record<string, string | undefined>): string {
  return text
    .split(/\n[ \t]*\n/)
    .flatMap((paragraph) => {
      const lines = paragraph.split("\n");
      const variableLines = lines.filter((l) => VARIABLE_ONLY_LINE.test(l));
      if (!variableLines.length) return [paragraph];
      const kept = lines.filter((l) => !VARIABLE_ONLY_LINE.test(l) || substitute(l, vars).trim());
      const allEmpty = kept.every((l) => !VARIABLE_ONLY_LINE.test(l));
      if (allEmpty && kept.length <= 1 && !kept.some((l) => HAS_VARIABLE.test(l))) return [];
      return [kept.join("\n")];
    })
    .join("\n\n");
}

/**
 * Remplace les variables {{nom}} par leur valeur. Une variable inconnue
 * est remplacée par une chaîne vide, pour ne jamais envoyer « {{prenom}} » à un client.
 * Un titre suivi d'une info vide n'est pas envoyé (voir dropEmptySections).
 */
export function renderTemplate(text: string, vars: Record<string, string | undefined>): string {
  return substitute(dropEmptySections(text, vars), vars)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Prénom tiré du nom de profil WhatsApp, seulement quand il est sûr : un seul mot fait de lettres
 * (« Jules », « Marie-Anne »). « Pauwels Jules » ou « Jules Pauwels » : impossible de savoir lequel est le
 * prénom → vide, et « Hello {{prenom}} ! » devient « Hello ! ». Pareil pour un pseudo, des chiffres, un
 * nom de commerce ou un emoji.
 */
export function firstName(profileName: string | undefined): string {
  const parts = profileName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length !== 1) return "";
  const word = parts[0];
  if (!/^\p{L}[\p{L}'’-]{1,19}$/u.test(word)) return "";
  // « JULES » → « Jules » ; « jules » → « Jules ».
  return word.charAt(0).toLocaleUpperCase("fr") + (word === word.toLocaleUpperCase("fr") ? word.slice(1).toLocaleLowerCase("fr") : word.slice(1));
}
