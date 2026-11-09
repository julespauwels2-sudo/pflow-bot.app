/**
 * « Diagnostic des comptes WhatsApp » (page État), réservé aux administrateurs du bot : LECTURE SEULE chez Meta
 * avec le token du serveur. Aucune écriture, aucun message, le token n'est jamais renvoyé. Pour chaque numéro sans
 * canal : le SQL du canal en test, proposé (rien n'est appliqué).
 */
import { NextResponse } from "next/server";
import { getChannelsRuntime, readWhatsAppConfig } from "@/channels/core/runtime";
import { canalInsertSql, diagnoseWhatsAppAccounts, guessRestaurant, parseSaisis, restoParNom } from "@/channels/whatsapp/diagnostic";
import { checkBotAdmin } from "@/lib/server-auth";
import { tooManyRequests } from "@/lib/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Numéro de Jules, premier numéro de test de chaque nouveau canal. */
const TEST_NUMERO = "590690938108";

export async function POST(request: Request) {
  const caller = await checkBotAdmin(request.headers.get("authorization"));
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const limited = tooManyRequests("comptes-whatsapp", request, caller.userId, 6);
  if (limited) return limited;
  const config = readWhatsAppConfig();
  if (!config.ready) return NextResponse.json({ error: `WhatsApp non configuré (manque : ${config.missing.join(", ")}).` }, { status: 503 });
  try {
    // Comptes saisis à la main (IDs relevés dans Business Manager), facultatif.
    const body = (await request.json().catch(() => ({}))) as { comptes?: unknown };
    const saisis = typeof body.comptes === "string" ? parseSaisis(body.comptes.slice(0, 2000)) : [];
    const rt = await getChannelsRuntime();
    const canaux = (await rt.store.listCanaux()).filter((c) => c.plateforme === "whatsapp");
    const accountIds = [...new Set(canaux.flatMap((c) => [c.messagingAccountId, c.wabaId]).filter((v): v is string => Boolean(v)))];
    const result = await diagnoseWhatsAppAccounts(
      { token: config.token, base: config.graphBase, version: config.graphVersion },
      { accountIds, canaux: canaux.map((c) => ({ id: c.id, etat: c.etat, compteId: c.accountId })), saisis: saisis.map((s) => s.id) },
    );
    // Restos du CRM (nom), pour proposer le bon restaurant_id ; le mode est celui du bot du resto.
    const workspace = await rt.workspace().catch(() => null);
    const restos = (workspace?.clients ?? []).map((c) => ({ id: c.id, nom: c.nomResto, mode: c.triggerMode as string | undefined }));
    const propositions = result.comptes.flatMap((compte) =>
      compte.numeros
        .filter((n) => !n.canal)
        .map((numero) => {
          const nomSaisi = saisis.find((s) => s.id === compte.id)?.resto;
          const resto = (nomSaisi ? restoParNom(nomSaisi, restos) : null) ?? guessRestaurant(numero, restos);
          const mode = restos.find((r) => r.id === resto?.id)?.mode ?? "mots_cles_uniquement";
          return { numero: numero.affichage ?? numero.id, resto: resto?.nom ?? null, sql: canalInsertSql({ restaurant: resto, compte, numero, mode, testNumero: TEST_NUMERO }) };
        }),
    );
    return NextResponse.json({ testeLe: new Date().toISOString(), version: config.graphVersion, ...result, propositions }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
