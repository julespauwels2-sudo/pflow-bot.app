/** Masque les numéros et identifiants dans un texte destiné aux journaux (données personnelles). */
export function maskId(text: string): string {
  return text.replace(/\+?\d{6,}/g, (d) => `${d.slice(0, 4)}•••${d.slice(-2)}`);
}
