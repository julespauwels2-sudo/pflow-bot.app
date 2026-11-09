import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthGate } from "@/components/auth-gate";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

// Polices de la charte PFlow (mêmes fichiers que le CRM) : Anton pour les titres, Plus Jakarta Sans pour le texte.
const anton = localFont({ src: "./fonts/anton-400.woff2", variable: "--font-anton", weight: "400", display: "swap" });
const jakarta = localFont({
  src: [
    { path: "./fonts/pjs-400.woff2", weight: "400" },
    { path: "./fonts/pjs-600.woff2", weight: "600" },
    { path: "./fonts/pjs-700.woff2", weight: "700" },
    { path: "./fonts/pjs-800.woff2", weight: "800" },
  ],
  variable: "--font-jakarta",
  display: "swap",
});

/** Écrans de lancement de l'app installée sur iPhone (public/splash, générés depuis le logo PFlow). */
const SPLASH: [number, number, number][] = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2], [320, 568, 2],
];
const startupImage = SPLASH.map(([w, h, r]) => ({
  url: `/splash/splash-${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));

export const metadata: Metadata = {
  title: "PFlow Bots",
  description: "Plateforme de chatbots WhatsApp de PFlow",
  robots: { index: false, follow: false },
  // App installable sur l'écran d'accueil de l'iPhone (notifications push : voir src/components/pwa.tsx).
  // Barre d'état transparente : les en-têtes nuit passent dessous (zones sûres gérées par la page).
  appleWebApp: { capable: true, title: "PFlow Bots", statusBarStyle: "black-translucent", startupImage },
};

// viewportFit « cover » : les zones sûres de l'iPhone (barre d'accueil) sont gérées par la page (env(safe-area-inset-*)).
export const viewport: Viewport = { themeColor: "#0A1236", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${anton.variable} ${jakarta.variable}`}>
      <body className="min-h-screen antialiased">
        <PwaRegister />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
