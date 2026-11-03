/**
 * Remplace les variables {{nom}} par leur valeur. Une variable inconnue
 * est remplacée par une chaîne vide, pour ne jamais envoyer « {{prenom}} » à un client.
 */
export function renderTemplate(text: string, vars: Record<string, string | undefined>): string {
  return text
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Premier mot du nom de profil WhatsApp (« Jules Pauwels » → « Jules »). */
export function firstName(profileName: string | undefined): string {
  return profileName?.trim().split(/\s+/)[0] ?? "";
}
