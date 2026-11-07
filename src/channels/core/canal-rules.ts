/** Numéros de test fournis par Meta : +1 555 … (jamais « actif » : voir /api/etat/canal). */
export const isMetaTestNumber = (display: string | undefined): boolean => /^\+?\s*1[\s-]*555/.test(display ?? "");
