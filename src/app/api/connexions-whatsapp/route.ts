/**
 * « Connecter votre WhatsApp » côté Jules (administrateurs du bot) :
 * - GET : les demandes de connexion (en cours, terminées, erreurs), les restos, ce qui manque à la configuration ;
 * - POST { restaurantId } : un lien unique et expirant (7 jours) à envoyer au gérant. Le jeton du lien n'est montré
 *   qu'une fois : seule son empreinte est gardée.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { embeddedSignupMissing, getChannelsRuntime, type ChannelsRuntime } from "@/channels/core/runtime";
import { etatEffectif, hashJeton, nouveauJetonLien } from "@/channels/core/connexions";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIEN_JOURS = 7;
const schema = z.object({ restaurantId: z.string().min(1).max(64) });

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
      nomResto: noms.get(c.restaurantId) ?? "Resto inconnu",
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
  if (!parsed.success) return NextResponse.json({ error: "Resto manquant" }, { status: 400 });
  const data = await a.rt.workspace();
  const resto = data.clients.find((c) => c.id === parsed.data.restaurantId);
  if (!resto) return NextResponse.json({ error: "Resto introuvable" }, { status: 404 });
  const jeton = nouveauJetonLien();
  try {
    const c = await a.rt.connexions.create({
      restaurantId: resto.id,
      jetonHash: hashJeton(jeton),
      expireLe: new Date(Date.now() + LIEN_JOURS * 86_400_000).toISOString(),
      creePar: a.userId ?? undefined,
    });
    const base = (process.env.PFLOW_BOTS_PUBLIC_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");
    return NextResponse.json({ url: `${base}/connecter/${jeton}`, expireLe: c.expireLe, nomResto: resto.nomResto });
  } catch (error) {
    return NextResponse.json({ error: `Lien non créé (migration bot_connexions_whatsapp jouée ?) : ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
