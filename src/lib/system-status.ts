/**
 * État du système (côté serveur) : quelles clés sont présentes — jamais leur valeur —, quels canaux et
 * services sont actifs. Lu par la route /api/etat, réservée aux administrateurs du bot.
 */
import { readInstagramConfig, readWhatsAppConfig, storeMode } from "@/channels/core/runtime";
import { transcriptionStatus } from "@/channels/voice/transcriber";
import { serverModel } from "@/ai/server-port";

export interface KeyStatus {
  name: string;
  role: string;
  present: boolean;
}

/** Liste des variables connues. Seule la présence est lue. */
const KEYS: { name: string; role: string }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", role: "Base Supabase (adresse)" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", role: "Base Supabase (clé publique)" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", role: "Base Supabase côté serveur (webhooks)" },
  { name: "ANTHROPIC_API_KEY", role: "IA (Claude)" },
  { name: "WHATSAPP_TOKEN", role: "WhatsApp : envoi" },
  { name: "WHATSAPP_APP_SECRET", role: "WhatsApp : signature des notifications" },
  { name: "WHATSAPP_VERIFY_TOKEN", role: "WhatsApp : vérification du webhook" },
  { name: "INSTAGRAM_TOKEN", role: "Instagram : envoi" },
  { name: "INSTAGRAM_APP_SECRET", role: "Instagram : signature des notifications" },
  { name: "INSTAGRAM_VERIFY_TOKEN", role: "Instagram : vérification du webhook" },
  { name: "PFLOW_BOTS_SECRET", role: "Lien avec PFlow Order (événements de commande, jeton de contact)" },
  { name: "PFLOW_ORDER_PONT_CLE", role: "Suivi et annulation de commande par l'IA (= PONT_CLE du CRM)" },
  { name: "TRANSCRIPTION_API_KEY", role: "Messages vocaux : clé du service (Groq)" },
  { name: "TRANSCRIPTION_PROVIDER", role: "Messages vocaux : service, facultatif (groq par défaut)" },
  { name: "CRON_SECRET", role: "Tâches planifiées (suppression quotidienne, démo à la minute)" },
  { name: "VAPID_PUBLIC_KEY", role: "Alertes (notifications push) : clé publique VAPID" },
  { name: "VAPID_PRIVATE_KEY", role: "Alertes (notifications push) : clé privée VAPID (secrète)" },
  { name: "VAPID_SUBJECT", role: "Alertes (notifications push) : contact, facultatif (défaut : adresse de PFlow Bots)" },
  { name: "BASIC_AUTH_PASSWORD", role: "Mot de passe provisoire du site" },
];

const present = (name: string) => Boolean(process.env[name]?.trim());

export function keyStatuses(): KeyStatus[] {
  return KEYS.map((k) => ({ ...k, present: present(k.name) }));
}

export interface ChannelStatus {
  plateforme: "whatsapp" | "instagram";
  configure: boolean;
  missing: string[];
  webhook: string;
}

export function channelStatuses(): ChannelStatus[] {
  const wa = readWhatsAppConfig();
  const ig = readInstagramConfig();
  return [
    { plateforme: "whatsapp", configure: wa.ready, missing: wa.ready ? [] : wa.missing, webhook: "/api/webhooks/whatsapp" },
    { plateforme: "instagram", configure: ig.ready, missing: ig.ready ? [] : ig.missing, webhook: "/api/webhooks/instagram" },
  ];
}

export function servicesStatus() {
  const t = transcriptionStatus();
  return {
    stockage: storeMode(),
    ia: { active: present("ANTHROPIC_API_KEY"), modele: serverModel() },
    transcription: { active: t.active, ...(t.provider ? { service: t.provider } : {}) },
    deploiement: process.env.VERCEL ? "vercel" : "local",
  };
}
