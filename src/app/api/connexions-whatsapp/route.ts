/**
 * « Connecter votre WhatsApp » côté Jules (administrateurs du bot) :
 * - GET : les demandes de connexion (en cours, terminées, erreurs), les restos, ce qui manque à la configuration ;
 * - POST { restaurantId } : un lien unique et expirant (7 jours) à envoyer au gérant. Le jeton du lien n'est montré
 *   qu'une fois : seule son empreinte est gardée.
 * - POST { clientTest: { nom } } : un lien pour un client test HORS CRM (vidéo de l'examen Meta) : identifiant propre,
 *   relié à aucun resto ; son canal reste en test (seul le numéro de Jules reçoit des réponses).
 * - POST { action: "debrancher", id } : débranche un numéro connecté (app désabonnée, canal coupé, jeton effacé).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { embeddedSignupMissing, getChannelsRuntime, readWhatsAppConfig, type ChannelsRuntime } from "@/channels/core/runtime";
import { etatEffectif, hashJeton, nouveauJetonLien } from "@/channels/core/connexions";
import { debrancherConnexion } from "@/channels/whatsapp/embedded-signup";
import { dechiffrerJeton } from "@/lib/jetons-chiffres";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIEN_JOURS = 7;
const schema = z.union([
  z.object({ restaurantId: z.string().min(1).max(64) }),
  z.object({ clientTest: z.object({ nom: z.string().trim().min(2).max(60) }) }),
  z.object({ action: z.literal("debrancher"), id: z.string().min(1).max(64) }),
]);

type Acces = { error: NextResponse; rt?: undefined; userId?: undefined } | { error?: undefined; rt: ChannelsRuntime; userId: string | null };

async function access(request: Request, max: number): Promise<Acces> {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { error: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const limited = tooManyRequests("connexions-whatsapp", request, caller.userId, max);
  if (limited) return { error: limited };
  try {
    return { rt: await getChannelsRuntime(), userId: caller.userId };
  } catch (error) {
    return { error: NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) };
  }
}

export async function GET(request: Request) {
  const a = await access(request, 60);
  if (a.error) return a.error;
  const data = await a.rt.workspace();
  const noms = new Map(data.clients.map((c) => [c.id, c.nomResto]));
  let connexions: unknown[] = [];
  let tableAbsente = false;
  try {
    connexions = (await a.rt.connexions.list(50)).map((c) => ({
      id: c.id,
      restaurantId: c.restaurantId,
      nomResto: c.libelle ?? noms.get(c.restaurantId) ?? "Resto inconnu",
      clientTest: Boolean(c.clientTest),
      etat: etatEffectif(c),
      expireLe: c.expireLe,
      creeLe: c.creeLe,
      termineLe: c.termineLe ?? null,
      numeroAffiche: c.numeroAffiche ?? null,
      wabaId: c.wabaId ?? null,
      phoneNumberId: c.phoneNumberId ?? null,
      canalId: c.canalId ?? null,
      etapes: c.etapes,
      erreur: c.erreur ?? null,
    }));
  } catch {
    tableAbsente = true;
  }
  const restos = data.clients
    .filter((c) => !c.crmStatut || ["signe", "actif", "demo"].includes(c.crmStatut))
    .map((c) => ({ id: c.id, nom: c.nomResto }))
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  return NextResponse.json({ manque: embeddedSignupMissing(), tableAbsente, connexions, restos }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const a = await access(request, 20);
  if (a.error) return a.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande incomplète" }, { status: 400 });
  const demande = parsed.data;

  if ("action" in demande) {
    const c = (await a.rt.connexions.list(200)).find((x) => x.id === demande.id);
    if (!c) return NextResponse.json({ error: "Connexion introuvable" }, { status: 404 });
    if (c.etat !== "terminee") return NextResponse.json({ error: "Seule une connexion terminée se débranche" }, { status: 409 });
    const wa = readWhatsAppConfig();
    let token: string | null = null;
    try {
      const chiffre = c.wabaId ? await a.rt.connexions.jetonChiffre(c.wabaId) : null;
      token = chiffre ? dechiffrerJeton(chiffre) : null;
    } catch {
      token = null;
    }
    const done = await debrancherConnexion(
      { meta: { base: process.env.WHATSAPP_GRAPH_BASE?.trim() || "https://graph.facebook.com", version: wa.ready ? wa.graphVersion : process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v24.0" }, connexions: a.rt.connexions, store: a.rt.store },
      c,
      token,
    );
    return NextResponse.json({ ok: true, etat: done.etat, etapes: done.etapes });
  }

  const data = await a.rt.workspace();
  let cible: { restaurantId: string; nom: string; clientTest?: boolean };
  if ("clientTest" in demande) {
    // Hors CRM : un identifiant propre, qui ne correspond à aucun resto (rien côté CRM ni PFlow Order).
    cible = { restaurantId: crypto.randomUUID(), nom: demande.clientTest.nom, clientTest: true };
  } else {
    const resto = data.clients.find((c) => c.id === demande.restaurantId);
    if (!resto) return NextResponse.json({ error: "Resto introuvable" }, { status: 404 });
    cible = { restaurantId: resto.id, nom: resto.nomResto };
  }
  const jeton = nouveauJetonLien();
  try {
    const c = await a.rt.connexions.create({
      restaurantId: cible.restaurantId,
      ...(cible.clientTest ? { clientTest: true, libelle: cible.nom } : {}),
      jetonHash: hashJeton(jeton),
      expireLe: new Date(Date.now() + LIEN_JOURS * 86_400_000).toISOString(),
      creePar: a.userId ?? undefined,
    });
    const base = (process.env.PFLOW_BOTS_PUBLIC_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");
    return NextResponse.json({ url: `${base}/connecter/${jeton}`, expireLe: c.expireLe, nomResto: cible.nom, clientTest: Boolean(cible.clientTest) });
  } catch (error) {
    return NextResponse.json({ error: `Lien non créé (migration bot_connexions_whatsapp jouée ?) : ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
