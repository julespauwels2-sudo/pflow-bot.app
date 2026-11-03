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

export function checkBasicAuth(authorization: string | null, config: BasicAuthConfig): BasicAuthDecision {
  if (!config.password) {
    // En local sans mot de passe : accès libre. En production : on bloque tout.
    return config.isProduction ? "not_configured" : "allow";
  }
  if (!authorization?.startsWith("Basic ")) return "challenge";

  let decoded: string;
  try {
    decoded = atob(authorization.slice("Basic ".length).trim());
  } catch {
    return "challenge";
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return "challenge";
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  const userOk = safeEqual(user, config.user || "pflow");
  const passwordOk = safeEqual(password, config.password);
  return userOk && passwordOk ? "allow" : "challenge";
}
