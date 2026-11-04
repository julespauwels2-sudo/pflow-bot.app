import type { Metadata } from "next";
import { Fredoka, Manrope } from "next/font/google";
import { AuthGate } from "@/components/auth-gate";
import "./globals.css";

const fredoka = Fredoka({ variable: "--font-fredoka", subsets: ["latin"], weight: ["500", "600", "700"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PFlow Bots",
  description: "Plateforme de chatbots WhatsApp de PFlow",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${fredoka.variable} ${manrope.variable}`}>
      <body className="min-h-screen antialiased">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
