/**
 * Les 10 modèles WhatsApp de la livraison, COMPTE PAR COMPTE : chaque numéro de resto (canal WhatsApp « resto ») a son
 * compte WhatsApp ; un modèle appartient à un compte, il faut donc les 10 sur le compte de chaque resto. Administrateurs
 * du bot seulement.
 * - GET : pour chaque compte, le statut des 10 chez Meta (APPROVED, PENDING, REJECTED…, ou absent) ;
 * - POST { canalId } ou { tous: true } : crée les manquants et les soumet à l'examen. Jamais de modification.
 * Jeton : celui du client si le numéro a été connecté par l'Embedded Signup, sinon le jeton général (WHATSAPP_TOKEN).
 * Identifiant : celui du compte de messagerie s'il est connu (nouveau modèle de comptes de Meta), sinon le WABA ; le
 * second est essayé si le premier est refusé.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChannelsRuntime, readWhatsAppConfig, type ChannelsRuntime } from "@/channels/core/runtime";
import type { Canal } from "@/channels/core/types";
import { modelesLivraison, type ModelesResultat } from "@/channels/whatsapp/embedded-signup";
import { dechiffrerJeton } from "@/lib/jetons-chiffres";
import { tooManyRequests } from "@/lib/request-limit";
import { checkBotAdmin } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Pret = { error: NextResponse; rt?: undefined } | { error?: undefined; rt: ChannelsRuntime; token: string; base: string; version: string };

async function preparer(request: Request, max: number): Promise<Pret> {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return { error: NextResponse.json({ error: caller.error }, { status: caller.status }) };
  const limited = tooManyRequests("modeles-livraison", request, caller.userId, max);
  if (limited) return { error: limited };
  const wa = readWhatsAppConfig();
  if (!wa.ready) return { error: NextResponse.json({ error: `WhatsApp non configuré : ${wa.missing.join(", ")}` }, { status: 503 }) };
  return { rt: await getChannelsRuntime(), token: wa.token, base: wa.graphBase, version: wa.graphVersion };
}

interface CompteResultat extends Partial<ModelesResultat> {
  canalId: string;
  libelle: string;
  compteId: string | null;
  jeton: "client" | "general";
  error?: string;
}

async function traiter(p: Extract<Pret, { rt: ChannelsRuntime }>, canal: Canal, creer: boolean, noms: Map<string, string>): Promise<CompteResultat> {
  const libelle = `${canal.numeroAffiche ?? canal.accountId}${noms.get(canal.restaurantId) ? ` · ${noms.get(canal.restaurantId)}` : ""}`;
  let token = p.token;
  let jeton: CompteResultat["jeton"] = "general";
  try {
    const chiffre = canal.wabaId ? await p.rt.connexions.jetonChiffre(canal.wabaId) : null;
    if (chiffre) {
      token = dechiffrerJeton(chiffre);
      jeton = "client";
    }
  } catch {
    // jeton général
  }
  const ids = [...new Set([canal.messagingAccountId, canal.wabaId].filter((v): v is string => Boolean(v && /^\d{5,30}$/.test(v))))];
  if (!ids.length) return { canalId: canal.id, libelle, compteId: null, jeton, error: "Aucun identifiant de compte sur ce canal (à compléter : compte de messagerie)" };
  let derniere = "";
  for (const id of ids) {
    try {
      const r = await modelesLivraison({ base: p.base, version: p.version }, id, token, creer);
      return { canalId: canal.id, libelle, compteId: id, jeton, ...r };
    } catch (error) {
      derniere = (error as Error).message;
    }
  }
  return { canalId: canal.id, libelle, compteId: ids[0], jeton, error: `Lecture chez Meta impossible : ${derniere}` };
}

async function canauxResto(rt: ChannelsRuntime) {
  return (await rt.store.listCanaux()).filter((c) => c.plateforme === "whatsapp" && (c.role ?? "resto") === "resto" && c.etat !== "coupe");
}

async function nomsRestos(rt: ChannelsRuntime) {
  const data = await rt.workspace().catch(() => null);
  return new Map((data?.clients ?? []).map((c) => [c.id, c.nomResto]));
}

export async function GET(request: Request) {
  const p = await preparer(request, 20);
  if (p.error) return p.error;
  const noms = await nomsRestos(p.rt);
  const comptes = [];
  for (const canal of await canauxResto(p.rt)) comptes.push(await traiter(p, canal, false, noms));
  return NextResponse.json({ comptes }, { headers: { "cache-control": "no-store" } });
}

const corps = z.union([z.object({ canalId: z.string().min(1).max(64) }), z.object({ tous: z.literal(true) })]);

export async function POST(request: Request) {
  const p = await preparer(request, 5);
  if (p.error) return p.error;
  const parsed = corps.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande incomplète" }, { status: 400 });
  const canaux = await canauxResto(p.rt);
  const cibles = "tous" in parsed.data ? canaux : canaux.filter((c) => "canalId" in parsed.data && c.id === parsed.data.canalId);
  if (!cibles.length) return NextResponse.json({ error: "Canal inconnu" }, { status: 400 });
  const noms = await nomsRestos(p.rt);
  const comptes = [];
  for (const canal of cibles) comptes.push(await traiter(p, canal, true, noms));
  return NextResponse.json({ comptes });
}
