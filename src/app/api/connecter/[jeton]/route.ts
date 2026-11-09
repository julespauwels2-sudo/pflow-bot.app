/**
 * Page publique « Connecter votre WhatsApp » (/connecter/<jeton>), côté serveur. Pas de compte : le jeton du lien
 * (unique, expirant, gardé seulement en empreinte) est la seule clé.
 * - GET : le nom du resto, l'état du lien, et ce dont la page a besoin pour ouvrir l'Embedded Signup (identifiant de
 *   l'app et de la configuration : pas des secrets).
 * - POST { type: "termine", code, wabaId, phoneNumberId, businessId?, evenement } : fin du parcours (jeton du client
 *   échangé et chiffré, app abonnée, canal en test, modèles de livraison) ;
 *   POST { type: "annule" | "erreur", etape?, detail?, sessionId? } : noté pour la page État.
 * Aucun secret, aucun jeton dans les réponses ni dans les journaux.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { etatEffectif, hashJeton, jetonValide, type Connexion } from "@/channels/core/connexions";
import { getChannelsRuntime, metaAppConfig, type ChannelsRuntime } from "@/channels/core/runtime";
import { idsValides, terminerConnexion } from "@/channels/whatsapp/embedded-signup";
import { tooManyRequests } from "@/lib/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ jeton: string }> };

const fin = z.object({
  type: z.literal("termine"),
  code: z.string().min(10).max(2000),
  wabaId: z.string().max(40),
  phoneNumberId: z.string().max(40),
  businessId: z.string().max(40).optional(),
  evenement: z.enum(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]),
});
const incident = z.object({
  type: z.enum(["annule", "erreur"]),
  etape: z.string().max(80).optional(),
  detail: z.string().max(300).optional(),
  sessionId: z.string().max(120).optional(),
});

const introuvable = () => NextResponse.json({ error: "Lien invalide ou expiré : demandez un nouveau lien à PFlow." }, { status: 404 });

type Charge = { error: NextResponse; rt?: undefined; c?: undefined } | { error?: undefined; rt: ChannelsRuntime; c: Connexion };

async function charger(request: Request, ctx: Ctx, max: number): Promise<Charge> {
  const limited = tooManyRequests("connecter", request, null, max);
  if (limited) return { error: limited };
  const { jeton } = await ctx.params;
  if (!jetonValide(jeton)) return { error: introuvable() };
  try {
    const rt = await getChannelsRuntime();
    const c = await rt.connexions.byJetonHash(hashJeton(jeton));
    if (!c) return { error: introuvable() };
    return { rt, c };
  } catch {
    return { error: NextResponse.json({ error: "Connexion pas encore disponible : réessayez plus tard ou contactez PFlow." }, { status: 503 }) };
  }
}

const vue = (c: Connexion, nomResto: string) => ({
  nomResto,
  etat: etatEffectif(c),
  expireLe: c.expireLe,
  numeroAffiche: c.numeroAffiche ?? null,
  etapes: c.etapes.map((e) => ({ etape: e.etape, ok: e.ok })),
});

export async function GET(request: Request, ctx: Ctx) {
  const a = await charger(request, ctx, 60);
  if (a.error) return a.error;
  const nomResto = a.c.libelle ?? (await a.rt.workspace()).clients.find((x) => x.id === a.c.restaurantId)?.nomResto ?? "votre restaurant";
  const meta = metaAppConfig();
  return NextResponse.json(
    { ...vue(a.c, nomResto), meta: meta ? { appId: meta.appId, configId: meta.configId, version: meta.version } : null },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, ctx: Ctx) {
  const a = await charger(request, ctx, 10);
  if (a.error) return a.error;
  const body = await request.json().catch(() => null);
  const etat = etatEffectif(a.c);
  const nomResto = a.c.libelle ?? (await a.rt.workspace()).clients.find((x) => x.id === a.c.restaurantId)?.nomResto ?? "votre restaurant";

  const inc = incident.safeParse(body);
  if (inc.success) {
    if (etat === "terminee" || etat === "expiree") return NextResponse.json(vue(a.c, nomResto));
    const d = inc.data;
    const detail = [d.etape && `étape ${d.etape}`, d.detail, d.sessionId && `session ${d.sessionId}`].filter(Boolean).join(" · ");
    await a.rt.connexions.update({
      ...a.c,
      etat: d.type === "annule" ? "annulee" : "erreur",
      erreur: (d.type === "annule" ? `Abandon du gérant${detail ? ` (${detail})` : ""}` : `Erreur Meta${detail ? ` : ${detail}` : ""}`).slice(0, 300),
      etapes: [...a.c.etapes, { etape: d.type === "annule" ? "abandon" : "erreur_meta", ok: false, ...(detail ? { detail: detail.slice(0, 300) } : {}), le: new Date().toISOString() }],
    });
    return NextResponse.json({ ok: true });
  }

  const f = fin.safeParse(body);
  if (!f.success || !idsValides(f.data)) return NextResponse.json({ error: "Réponse de Meta incomplète" }, { status: 400 });
  if (etat === "expiree") return introuvable();
  if (etat === "terminee") return NextResponse.json(vue(a.c, nomResto));
  if (etat === "en_cours") return NextResponse.json({ error: "Connexion déjà en cours : patientez quelques secondes." }, { status: 409 });
  const meta = metaAppConfig();
  if (!meta) return NextResponse.json({ error: "Connexion pas encore disponible (configuration Meta incomplète) : contactez PFlow." }, { status: 503 });

  const done = await terminerConnexion({ meta, connexions: a.rt.connexions, store: a.rt.store }, a.c, f.data);
  return NextResponse.json(vue(done, nomResto), { status: done.etat === "erreur" ? 502 : 200 });
}
