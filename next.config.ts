import type { NextConfig } from "next";

/**
 * En-têtes de sécurité sur toutes les pages et routes (audit du 5 novembre 2026, docs/securite.md).
 * Pas encore de Content-Security-Policy stricte : Next.js injecte des scripts en ligne, à régler
 * avec des « nonces » plus tard (noté dans l'audit).
 */
/**
 * 16/11/2026 (CRM /crm, onglet PFlow Bots) : l'appli peut s'afficher DANS le CRM de PFlow, et seulement lui.
 * PFLOW_CRM_ORIGINES (variable Vercel, adresses séparées par des espaces, ex. « https://order.pflow.fr ») :
 * - absente (par défaut) : rien ne change, l'appli refuse tout cadre (DENY, frame-ancestors 'none') ;
 * - posée : seules ces adresses peuvent l'afficher dans un cadre (frame-ancestors), X-Frame-Options est retiré
 *   (il ne sait pas autoriser une liste d'adresses ; les navigateurs actuels suivent frame-ancestors).
 */
export function enTetesCadre(origines: string | undefined) {
  const liste = String(origines || "").split(/\s+/).filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
  if (!liste.length) {
    return [
      // Le site ne peut pas être affiché dans un cadre d'un autre site (clickjacking).
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ];
  }
  return [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' " + liste.join(" ") + "; base-uri 'self'; object-src 'none'" }];
}

const securityHeaders = [
  ...enTetesCadre(process.env.PFLOW_CRM_ORIGINES),
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Les adresses internes (avec identifiants de conversation) ne partent pas vers les autres sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
