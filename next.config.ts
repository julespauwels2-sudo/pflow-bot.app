import type { NextConfig } from "next";

/**
 * En-têtes de sécurité sur toutes les pages et routes (audit du 5 novembre 2026, docs/securite.md).
 * Pas encore de Content-Security-Policy stricte : Next.js injecte des scripts en ligne, à régler
 * avec des « nonces » plus tard (noté dans l'audit).
 */
const securityHeaders = [
  // Le site ne peut pas être affiché dans un cadre d'un autre site (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
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
