/**
 * Vérification côté serveur (routes API) : jeton Supabase d'un administrateur du bot.
 * Sans Supabase configuré, la protection reste celle du mot de passe provisoire (proxy).
 */
import { createClient } from "@supabase/supabase-js";

export type CallerCheck = { ok: true; userId: string | null } | { ok: false; status: number; error: string };

export async function checkBotAdmin(authorization: string | null): Promise<CallerCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return { ok: true, userId: null };

  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Connexion requise." };
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error } = await sb.auth.getUser(token);
  if (error || !userData.user) return { ok: false, status: 401, error: "Session expirée : reconnecte-toi." };
  // Avec son propre jeton, le compte ne voit que sa ligne de bot_admins (RLS).
  const { data: admin } = await sb.from("bot_admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!admin) return { ok: false, status: 403, error: "Compte non autorisé." };
  return { ok: true, userId: userData.user.id };
}
