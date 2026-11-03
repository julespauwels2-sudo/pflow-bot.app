/**
 * Protection provisoire par mot de passe (étape A), remplacée par Supabase Auth à l'étape B.
 * Logique isolée ici pour être testable sans Next.js.
 */

export type BasicAuthDecision = "allow" | "challenge" | "not_configured";

export interface BasicAuthConfig {
  user?: string;
  password?: string;
  isProduction: boolean;
}

/** Comparaison en temps constant (évite de deviner le mot de passe caractère par caractère). */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Décode la partie base64 de l'en-tête en UTF-8 (mots de passe avec accents compris). */
function decodeCredentials(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * - BASIC_AUTH_USER non défini : n'importe quel nom d'utilisateur est accepté, seul le mot de passe compte.
 * - BASIC_AUTH_USER défini : le nom doit correspondre exactement.
 * Les espaces et retours à la ligne autour des valeurs des variables d'environnement sont ignorés
 * (copier-coller dans Vercel).
 */
export function checkBasicAuth(authorization: string | null, config: BasicAuthConfig): BasicAuthDecision {
  const expectedPassword = config.password?.trim();
  const expectedUser = config.user?.trim();
  if (!expectedPassword) {
    // En local sans mot de passe : accès libre. En production : on bloque tout.
    return config.isProduction ? "not_configured" : "allow";
  }
  if (!authorization?.startsWith("Basic ")) return "challenge";

  const decoded = decodeCredentials(authorization.slice("Basic ".length).trim());
  if (decoded === null) return "challenge";
  const sep = decoded.indexOf(":");
  if (sep < 0) return "challenge";
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  const userOk = expectedUser ? safeEqual(user, expectedUser) : true;
  const passwordOk = safeEqual(password, expectedPassword);
  return userOk && passwordOk ? "allow" : "challenge";
}
