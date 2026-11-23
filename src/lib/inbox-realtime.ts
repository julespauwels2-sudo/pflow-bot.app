"use client";

/**
 * Boîte de réception en temps réel (Supabase Realtime) : un message reçu ou envoyé (bot_messages) ou un changement de
 * pause (bot_contacts) recharge la liste et la conversation ouverte, sans attendre. Repli : tant que le temps réel
 * n'est pas branché (publication pas encore activée, connexion coupée, mode local), l'écran se rafraîchit toutes les
 * 5 s comme avant ; quand il marche, un rafraîchissement toutes les 60 s reste en filet de sécurité.
 */
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";

export type InboxSync = "temps-reel" | "rafraichissement";

export const POLL_MS = { "temps-reel": 60_000, rafraichissement: 5_000 } as const;

export function useInboxRealtime(onChange: () => void): InboxSync {
  const [mode, setMode] = useState<InboxSync>("rafraichissement");
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Plusieurs lignes d'un coup (message + statut) : un seul rechargement.
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 300);
    };
    const channel = sb
      .channel("pflow-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_messages" }, fire)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bot_contacts" }, fire)
      .subscribe((status) => setMode(status === "SUBSCRIBED" ? "temps-reel" : "rafraichissement"));
    return () => {
      clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, []);
  return mode;
}
