import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthGate } from "@/components/auth-gate";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

// Les polices du site pflow.fr (mêmes fichiers) : Fredoka pour les titres, Manrope pour le texte.
const fredoka = localFont({ src: "./fonts/fredoka.woff2", variable: "--font-fredoka", weight: "300 700", display: "swap" });
const manrope = localFont({ src: "./fonts/manrope.woff2", variable: "--font-manrope", weight: "200 800", display: "swap" });

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
  // Barre d'état transparente : les en-têtes navy passent dessous (zones sûres gérées par la page).
  appleWebApp: { capable: true, title: "PFlow Bots", statusBarStyle: "black-translucent", startupImage },
};

// viewportFit « cover » : les zones sûres de l'iPhone (barre d'accueil) sont gérées par la page (env(safe-area-inset-*)).
export const viewport: Viewport = { themeColor: "#101B4D", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${fredoka.variable} ${manrope.variable}`}>
      <body className="min-h-screen antialiased">
        <PwaRegister />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
