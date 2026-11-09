import type { MetadataRoute } from "next";

/**
 * Application installable (écran d'accueil de l'iPhone, ordinateur) : ouvre directement la boîte de réception.
 * Sur iPhone, les notifications push ne marchent QUE depuis l'app ajoutée à l'écran d'accueil (iOS 16.4 ou plus).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/inbox",
    name: "PFlow Bots",
    short_name: "PFlow Bots",
    description: "Boîte de réception et alertes des chatbots PFlow",
    lang: "fr",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#F8F7FB",
    theme_color: "#101B4D",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
