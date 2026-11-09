import type { Metadata, Viewport } from "next";
import { Fredoka, Manrope } from "next/font/google";
import { AuthGate } from "@/components/auth-gate";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

const fredoka = Fredoka({ variable: "--font-fredoka", subsets: ["latin"], weight: ["500", "600", "700"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PFlow Bots",
  description: "Plateforme de chatbots WhatsApp de PFlow",
  robots: { index: false, follow: false },
  // App installable sur l'écran d'accueil de l'iPhone (notifications push : voir src/components/pwa.tsx).
  appleWebApp: { capable: true, title: "PFlow Bots", statusBarStyle: "default" },
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
