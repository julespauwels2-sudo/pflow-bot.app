/**
 * « Diagnostic des comptes WhatsApp » (page État) : LECTURE SEULE chez Meta, avec le token du serveur
 * (pflow-bots-serveur). Aucune écriture, aucun message envoyé, le token n'est jamais renvoyé.
 *
 * 1. Les comptes accessibles au token : portées détaillées du token (debug_token → granular_scopes), sinon les
 *    comptes de l'entreprise du token, plus ceux déjà connus des canaux.
 * 2. Pour chaque compte : nom, numéros (affichage, phone_number_id, qualité, statut, coexistence), apps abonnées.
 *    Nouveau modèle de comptes : l'ID du « compte WhatsApp » peut être refusé (sous-code 2388339) ; c'est l'ID du
 *    compte de messagerie qui répond.
 * 3. Pour chaque numéro sans canal : la ligne SQL du canal en test, à vérifier puis à jouer à la main.
 * Les comptes que le token ne sait pas lister (sans l'autorisation business_management) se saisissent à la main
 * (IDs relevés dans Business Manager) : ils sont interrogés directement, comme les autres.
 */
import type { GraphConfig } from "./graph";

export interface DiagnosticNumber {
  id: string;
  affichage?: string;
  nomVerifie?: string;
  qualite?: string;
  statut?: string;
  plateforme?: string;
  coexistence?: boolean;
  /** Canal déjà créé dans PFlow Bots pour ce numéro. */
  canal?: { id: string; etat: string };
}

export interface DiagnosticAccount {
  id: string;
  nom?: string;
  /** Comment le compte a été trouvé. */
  origine: string[];
  numeros: DiagnosticNumber[];
  apps: string[];
  erreurs: string[];
}

export interface DiagnosticResult {
  comptes: DiagnosticAccount[];
  erreurs: string[];
}

type Json = Record<string, unknown>;

function graphError(json: Json, status: number): string {
  const e = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
  return `${status}${e.code ? ` / code ${e.code}` : ""}${e.error_subcode ? ` / sous-code ${e.error_subcode}` : ""} : ${e.message ?? "erreur"}`;
}

export async function diagnoseWhatsAppAccounts(
  config: GraphConfig,
  known: { accountIds: string[]; canaux: { id: string; etat: string; compteId: string }[]; saisis?: string[] },
): Promise<DiagnosticResult> {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = `${config.base.replace(/\/$/, "")}/${config.version}`;
  const get = async (path: string): Promise<{ ok: true; json: Json } | { ok: false; error: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
    try {
      const response = await doFetch(`${base}/${path}`, { method: "GET", headers: { authorization: `Bearer ${config.token}` }, signal: controller.signal });
      const json = (await response.json().catch(() => ({}))) as Json;
      return response.ok ? { ok: true, json } : { ok: false, error: graphError(json, response.status) };
    } catch (error) {
      return { ok: false, error: `Meta injoignable : ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  };

  const erreurs: string[] = [];
  const found = new Map<string, Set<string>>();
  const add = (id: unknown, origine: string) => {
    if (typeof id !== "string" || !/^\d{5,25}$/.test(id)) return;
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)!.add(origine);
  };

  // 1. Portées détaillées du token : les comptes WhatsApp et de messagerie attribués à l'utilisateur système.
  //    Le token passe dans l'en-tête et en paramètre input_token de debug_token (lecture de ses propres droits).
  const debug = await get(`debug_token?input_token=${encodeURIComponent(config.token)}`);
  if (debug.ok) {
    const scopes = (((debug.json.data ?? {}) as Json).granular_scopes ?? []) as { scope?: string; target_ids?: string[] }[];
    for (const s of scopes) if (s.scope?.startsWith("whatsapp_business")) for (const id of s.target_ids ?? []) add(id, "attribué au token");
  } else {
    erreurs.push(`Droits du token (debug_token) illisibles : ${debug.error}`);
  }

  // 2. Secours : les comptes de l'entreprise du token.
  if (!found.size) {
    const businesses = await get("me/businesses?fields=id,name&limit=10");
    if (businesses.ok) {
      for (const b of ((businesses.json.data ?? []) as { id?: string }[])) {
        for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
          const list = await get(`${encodeURIComponent(String(b.id))}/${edge}?fields=id,name&limit=50`);
          if (list.ok) for (const a of ((list.json.data ?? []) as { id?: string }[])) add(a.id, edge === "owned_whatsapp_business_accounts" ? "détenu par l'entreprise" : "partagé avec l'entreprise");
        }
      }
    } else {
      erreurs.push(`Entreprises du token illisibles : ${businesses.error}`);
    }
  }

  // 3. Les comptes déjà connus des canaux, et ceux saisis à la main.
  for (const id of known.accountIds) add(id, "canal existant");
  for (const id of known.saisis ?? []) add(id, "saisi à la main");

  const canalByPhone = new Map(known.canaux.map((c) => [c.compteId, { id: c.id, etat: c.etat }]));
  const comptes: DiagnosticAccount[] = [];
  for (const [id, origine] of found) {
    const account: DiagnosticAccount = { id, origine: [...origine], numeros: [], apps: [], erreurs: [] };
    // Lecture simple, sans liste de champs (certains champs sont refusés sur les comptes du nouveau modèle).
    const info = await get(encodeURIComponent(id));
    if (info.ok) account.nom = typeof info.json.name === "string" ? info.json.name : undefined;
    else account.erreurs.push(/2388339/.test(info.error) ? "Compte WhatsApp du nouveau modèle : l'API répond sur l'ID du compte de messagerie" : `Compte : ${info.error}`);

    let phones = await get(`${encodeURIComponent(id)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,platform_type,is_on_biz_app&limit=50`);
    // Champs refusés (« Invalid parameter ») : on relit sans les champs facultatifs.
    if (!phones.ok && /\b100\b|Invalid parameter/i.test(phones.error)) phones = await get(`${encodeURIComponent(id)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status&limit=50`);
    if (phones.ok) {
      for (const p of ((phones.json.data ?? []) as Json[])) {
        const phoneId = String(p.id ?? "");
        if (!phoneId) continue;
        account.numeros.push({
          id: phoneId,
          ...(typeof p.display_phone_number === "string" ? { affichage: p.display_phone_number } : {}),
          ...(typeof p.verified_name === "string" ? { nomVerifie: p.verified_name } : {}),
          ...(typeof p.quality_rating === "string" ? { qualite: p.quality_rating } : {}),
          ...(typeof p.status === "string" ? { statut: p.status } : {}),
          ...(typeof p.platform_type === "string" ? { plateforme: p.platform_type } : {}),
          ...(typeof p.is_on_biz_app === "boolean" ? { coexistence: p.is_on_biz_app } : {}),
          ...(canalByPhone.has(phoneId) ? { canal: canalByPhone.get(phoneId)! } : {}),
        });
      }
    } else if (!/2388339/.test(phones.error)) {
      account.erreurs.push(`Numéros : ${phones.error}`);
    }

    const apps = await get(`${encodeURIComponent(id)}/subscribed_apps`);
    if (apps.ok) {
      account.apps = ((apps.json.data ?? []) as { whatsapp_business_api_data?: { name?: string; id?: string } }[]).map((a) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? "?");
    } else if (!/2388339/.test(apps.error)) {
      account.erreurs.push(`Apps abonnées : ${apps.error}`);
    }
    comptes.push(account);
  }
  // Les comptes qui répondent (numéros trouvés) d'abord.
  comptes.sort((a, b) => b.numeros.length - a.numeros.length || a.id.localeCompare(b.id));
  return { comptes, erreurs };
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Le resto du CRM qui correspond à un numéro : même nom (affiché par Meta) ou même numéro WhatsApp. */
export function guessRestaurant(numero: DiagnosticNumber, restos: { id: string; nom: string; numeroWhatsapp?: string }[]): { id: string; nom: string } | null {
  const digits = (numero.affichage ?? "").replace(/\D/g, "");
  const byPhone = restos.find((r) => {
    const d = (r.numeroWhatsapp ?? "").replace(/\D/g, "");
    return d.length >= 9 && digits.endsWith(d.replace(/^0/, ""));
  });
  if (byPhone) return byPhone;
  const name = normalize(numero.nomVerifie ?? "");
  if (!name) return null;
  const byName = restos.filter((r) => {
    const n = normalize(r.nom);
    return n.length >= 3 && (name.includes(n) || n.includes(name));
  });
  return byName.length === 1 ? byName[0] : null;
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * SQL du canal en TEST d'un numéro (à vérifier puis à jouer à la main). Le compte de messagerie est celui qui a
 * répondu ; le WABA est à compléter s'il est différent (écran Paramètres de l'entreprise).
 */
export function canalInsertSql(input: { restaurant: { id: string; nom: string } | null; compte: DiagnosticAccount; numero: DiagnosticNumber; mode: string; testNumero: string }): string {
  const { restaurant, compte, numero } = input;
  const label = `${numero.affichage ?? numero.id} (${restaurant?.nom ?? numero.nomVerifie ?? "?"})`;
  return [
    "insert into public.bot_canaux",
    "  (restaurant_id, role, plateforme, compte_id, waba_id, messaging_account_id, numero_affiche,",
    "   mode_declenchement, coexistence, etat, test_numeros)",
    "values",
    `  (${restaurant ? sqlText(restaurant.id) : "'<RESTAURANT_ID>'"}, 'resto', 'whatsapp', ${sqlText(numero.id)}, null, ${sqlText(compte.id)},`,
    `   ${sqlText(label)}, ${sqlText(input.mode)}, ${numero.coexistence === undefined ? "<true|false>" : String(numero.coexistence)}, 'test', array[${sqlText(input.testNumero)}])`,
    "returning id, restaurant_id, numero_affiche, etat;  -- waba_id : laissé vide (le compte de messagerie suffit pour envoyer)",
  ].join("\n");
}

/**
 * IDs saisis dans le diagnostic : une ligne (ou une virgule) par compte, « ID » ou « ID nom du resto ». Seuls des
 * chiffres sont gardés comme ID (10 au plus) ; le nom aide à proposer le bon resto du CRM.
 */
export function parseSaisis(texte: string): { id: string; resto?: string }[] {
  return texte
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .map((l) => /^(\d{5,25})(?:\s*[:=-]?\s*(.+))?$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .slice(0, 10)
    .map((m) => ({ id: m[1], ...(m[2]?.trim() ? { resto: m[2].trim() } : {}) }));
}

/** Le resto du CRM désigné par un nom saisi (« ag pizza » → « ag_pizzaa ») : un seul candidat, sinon rien. */
export function restoParNom(nom: string, restos: { id: string; nom: string }[]): { id: string; nom: string } | null {
  const n = normalize(nom);
  if (n.length < 3) return null;
  const exact = restos.filter((r) => normalize(r.nom) === n);
  if (exact.length === 1) return exact[0];
  const proches = restos.filter((r) => {
    const x = normalize(r.nom);
    return x.length >= 3 && (x.includes(n) || n.includes(x) || x.replace(/ /g, "").startsWith(n.replace(/ /g, "")));
  });
  return proches.length === 1 ? proches[0] : null;
}
