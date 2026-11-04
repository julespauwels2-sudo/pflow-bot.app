"use client";

/**
 * Client Supabase du navigateur (étape B). URL et clé publique (« publishable ») viennent des
 * variables d'environnement NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY : sans elles,
 * l'app garde le stockage du navigateur (étape A).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Écrites en toutes lettres : Next.js les remplace au moment du build.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured || typeof window === "undefined") return null;
  client ??= createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "pflow-bots-auth" } });
  return client;
}

/** Jeton de la session en cours (pour appeler les routes serveur, ex. /api/ai). */
export async function accessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Vrai si le compte connecté est dans bot_admins (il ne voit que sa propre ligne). */
export async function isBotAdmin(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("bot_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}
