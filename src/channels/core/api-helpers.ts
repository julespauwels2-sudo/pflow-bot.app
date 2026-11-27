/** Accès commun des routes de la boîte de réception : connexion vérifiée, au moins un canal configuré. */
import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/request-limit";
import { checkAccesBoite, type RoleBoite } from "@/lib/server-auth";
import { getChannelsRuntime, readInstagramConfig, readWhatsAppConfig, type ChannelsRuntime } from "./runtime";
import type { Canal } from "./types";

export type InboxAccess =
  | {
      ok: true;
      runtime: ChannelsRuntime;
      role: RoleBoite;
      /** Utilisateur connecté (« local » sans Supabase) : non-lus synchronisés. */ userId: string;
      /** role « resto » : les restos de ce compte. */ restaurantIds?: string[];
    }
  | { ok: false; response: NextResponse };

/** Conversations visibles : tout pour un administrateur, sinon seulement les numéros permis (voir idsCanauxVisibles). */
export function canauxVisibles<T extends { canalId: string }>(role: RoleBoite, canaux: T[], permis: Set<string>): T[] {
  return role === "admin" ? canaux : canaux.filter((c) => permis.has(c.canalId));
}

/** Numéros permis : examinateur = le numéro PFlow (démos) ; resto = les numéros de ses restos ; admin = tous. */
export function canauxPermis(canaux: Canal[], access: { role: RoleBoite; restaurantIds?: string[] }): Set<string> {
  if (access.role === "examinateur") return new Set(canaux.filter((c) => c.role === "pflow").map((c) => c.id));
  if (access.role === "resto") {
    const restos = new Set(access.restaurantIds ?? []);
    return new Set(canaux.filter((c) => c.role !== "pflow" && restos.has(c.restaurantId)).map((c) => c.id));
  }
  return new Set(canaux.map((c) => c.id));
}

export async function idsCanauxVisibles(access: Extract<InboxAccess, { ok: true }>): Promise<Set<string>> {
  return canauxPermis(await access.runtime.store.listCanaux(), access);
}

export async function idsCanauxPflow(runtime: ChannelsRuntime): Promise<Set<string>> {
  return new Set((await runtime.store.listCanaux()).filter((c) => c.role === "pflow").map((c) => c.id));
}

export async function inboxAccess(request: Request, options: { adminSeulement?: boolean } = {}): Promise<InboxAccess> {
  const caller = await checkAccesBoite(request.headers.get("authorization"));
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  if (options.adminSeulement && caller.role !== "admin") return { ok: false, response: NextResponse.json({ error: "Compte non autorisé." }, { status: 403 }) };
  // La page se rafraîchit toutes les 5 s (2 appels) : 120 par minute laisse de la marge.
  const limited = tooManyRequests("inbox", request, caller.userId, 120);
  if (limited) return { ok: false, response: limited };
  const wa = readWhatsAppConfig();
  const ig = readInstagramConfig();
  if (!wa.ready && !ig.ready) {
    const missing = [...new Set([...(wa.ready ? [] : wa.missing), ...(ig.ready ? [] : ig.missing)])];
    return { ok: false, response: NextResponse.json({ available: false, missing }, { status: 200 }) };
  }
  try {
    return { ok: true, runtime: await getChannelsRuntime(), role: caller.role, userId: caller.userId ?? "local", restaurantIds: caller.restaurantIds };
  } catch (error) {
    return { ok: false, response: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}
