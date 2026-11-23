/**
 * Tournées récurrentes (Cookies An Nou, 22 novembre 2026) : planning hebdomadaire + exceptions datées → prochains
 * passages donnés à l'IA, qui répond seule (« Leslie passe à Jarry le mardi, de 8 h à 12 h ») et transfère si le lieu
 * n'y est pas. Le vrai texte de Claude n'est pas testé ici (pas de clé) : on vérifie ce que l'IA reçoit.
 */
import { describe, expect, it } from "vitest";
import { computedRounds, DEFAULT_CHANNEL_SETTINGS, infoSheetVariables, runEngine, type AiRequest, type Flow, type InfoSheet, type WeeklyRound } from "@/engine";
import { buildPrompt } from "../prompt";
import { ROUND_QUESTION_RULE } from "../knowledge";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import { toEngineFlow } from "@/data/types";
import { infoSheetSchema } from "@/data/schemas";

const TZ = "America/Guadeloupe";
const LUNDI_10H = new Date("2026-11-23T14:00:00Z"); // lundi 23 novembre, 10 h en Guadeloupe
const huit = { de: "08:00", a: "12:00" };
const PLANNING: WeeklyRound[] = [
  { id: "w2", jour: 2, lieux: "Jarry", ...huit },
  { id: "w3", jour: 3, lieux: "Dothémare", ...huit },
  { id: "w4", jour: 4, lieux: "Sainte-Anne", ...huit },
  { id: "w5", jour: 5, lieux: "Le Gosier", ...huit },
];
const cookies = (extra: Partial<InfoSheet> = {}): InfoSheet => ({
  horaires: [2, 3, 4, 5].map((jour) => ({ jour: jour as 2, plages: [huit] })),
  livraison: true,
  retrait: false,
  tourneesHebdo: PLANNING,
  reglesSpeciales: "- Si le lieu ou la date demandés ne figurent dans aucune tournée à venir, s'il n'y a aucune tournée, ou si le client veut une confirmation précise : utilise parler_equipe.",
  ...extra,
});

async function askAi(text: string, infoSheet: InfoSheet, now = LUNDI_10H): Promise<AiRequest> {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
  const requests: AiRequest[] = [];
  await runEngine(
    {
      now,
      client: { id: "c", nomResto: "Cookies An Nou", orderSlug: "cookies-an-nou", timezone: TZ },
      channel: { id: "ch", clientId: "c", triggerMode: "toujours", ...DEFAULT_CHANNEL_SETTINGS },
      flows,
      infoSheet,
      contact: { id: "x", profileName: "Léa", pause: null, aiUsage: { day: "", calls: 0 }, lastInboundAt: new Date(now.getTime() - 60_000).toISOString() },
      session: null,
      message: { kind: "text", text },
    },
    { ai: async (req) => (requests.push(req), { decision: { action: "repondre", texte: "ok", sujet: "autre" }, usage: { inputTokens: 1, outputTokens: 1 } }) },
  );
  return requests[0]!;
}
const kbOf = (req: AiRequest) => buildPrompt(req).system.find((b) => b.title === "Base de connaissances")!.text;
const contextOf = (req: AiRequest) => buildPrompt(req).system.find((b) => b.title === "Contexte")!.text;

describe("tournées récurrentes : prochains passages", () => {
  it("planning du mardi au vendredi : les passages des 14 prochains jours, dans l'ordre", () => {
    const r = computedRounds(cookies(), LUNDI_10H, TZ);
    expect(r.slice(0, 5).map((x) => [x.date, x.lieux, x.de, x.a])).toEqual([
      ["2026-11-24", "Jarry", "08:00", "12:00"],
      ["2026-11-25", "Dothémare", "08:00", "12:00"],
      ["2026-11-26", "Sainte-Anne", "08:00", "12:00"],
      ["2026-11-27", "Le Gosier", "08:00", "12:00"],
      ["2026-12-01", "Jarry", "08:00", "12:00"],
    ]);
    expect(r).toHaveLength(8);
    // Le jour même : compté tant que le créneau n'est pas fini.
    expect(computedRounds(cookies(), new Date("2026-11-24T13:00:00Z"), TZ)[0]!.date).toBe("2026-11-24"); // mardi 9 h
    expect(computedRounds(cookies(), new Date("2026-11-24T16:30:00Z"), TZ)[0]!.date).toBe("2026-11-25"); // mardi 12 h 30
  });

  it("exceptions : passage annulé (un lieu, ou « * » toute la journée), tournée ajoutée", () => {
    const annule = computedRounds(cookies({ tournees: [{ id: "x", date: "2026-11-24", lieux: "jarry", annulee: true }] }), LUNDI_10H, TZ);
    expect(annule.find((r) => r.date === "2026-11-24")).toBeUndefined();
    expect(annule[0]!.lieux).toBe("Dothémare");
    const ferie = computedRounds(cookies({ tournees: [{ id: "x", date: "2026-11-26", lieux: "*", annulee: true }] }), LUNDI_10H, TZ);
    expect(ferie.some((r) => r.date === "2026-11-26")).toBe(false);
    const ajout = computedRounds(cookies({ tournees: [{ id: "y", date: "2026-11-28", de: "09:00", a: "11:00", lieux: "Baie-Mahault — marché" }] }), LUNDI_10H, TZ);
    expect(ajout.find((r) => r.date === "2026-11-28")?.lieux).toBe("Baie-Mahault — marché");
  });

  it("sans planning hebdomadaire (Mexico, AG Pizza, autres restos) : les tournées datées, comme avant", () => {
    const dated: InfoSheet = { horaires: [], livraison: true, tournees: [{ id: "a", date: "2026-11-25", lieux: "Jarry" }, { id: "b", date: "2026-11-20", lieux: "Passée" }] };
    expect(computedRounds(dated, LUNDI_10H, TZ).map((r) => r.id)).toEqual(["a"]);
    expect(infoSheetVariables({ horaires: [], livraison: false, retrait: true }, LUNDI_10H, TZ).infos_livraison).toBe("Pas de livraison pour le moment : les commandes sont à retirer sur place.");
  });

  it("Infos pratiques : « Prochaines livraisons » calculées depuis le planning", () => {
    expect(infoSheetVariables(cookies(), LUNDI_10H, TZ).infos_livraison).toContain("• *Mardi 24 novembre* (8h – 12h) : Jarry");
  });

  it("la fiche accepte le planning et les exceptions annulées", () => {
    expect(infoSheetSchema.safeParse(cookies({ tournees: [{ id: "x", date: "2026-11-24", lieux: "*", annulee: true }] })).success).toBe(true);
  });
});

describe("tournées récurrentes : ce que reçoit l'IA", () => {
  it("« Vous passez quand à Jarry ? » : le planning de la semaine, les prochains passages et la consigne de répondre seule", async () => {
    const req = await askAi("Vous passez quand à Jarry ?", cookies());
    const kb = kbOf(req);
    expect(kb).toContain("Planning de chaque semaine :");
    expect(kb).toContain("• *Mardi* (8h – 12h) : Jarry");
    expect(kb).toContain("• *Mardi 24 novembre* (8h – 12h) : Jarry");
    expect(kb).toContain(ROUND_QUESTION_RULE);
  });

  it("« Vous passez où demain ? » : la date du jour (lundi) et le passage de demain (mardi, Jarry)", async () => {
    const req = await askAi("Vous passez où demain ?", cookies());
    expect(contextOf(req)).toContain("lundi 23 novembre 2026");
    expect(req.infoSheet.tournees?.[0]).toMatchObject({ date: "2026-11-24", lieux: "Jarry" });
  });

  it("un lieu absent (« Vous passez à Baie-Mahault ? ») : aucun passage, et la consigne de transférer", async () => {
    const kb = kbOf(await askAi("Vous passez à Baie-Mahault ?", cookies()));
    expect(kb).not.toContain("Baie-Mahault");
    expect(kb).toContain("n'apparaissent dans aucune de ces tournées");
    expect(kb).toContain("utilise parler_equipe");
  });

  it("une exception (Jarry annulé mardi 24) : l'IA ne voit plus ce passage, le prochain Jarry est le 1er décembre", async () => {
    const req = await askAi("Vous passez quand à Jarry ?", cookies({ tournees: [{ id: "x", date: "2026-11-24", lieux: "Jarry", annulee: true }] }));
    const kb = kbOf(req);
    expect(kb).not.toContain("Mardi 24 novembre");
    expect(req.infoSheet.tournees?.find((r) => r.lieux === "Jarry")?.date).toBe("2026-12-01");
  });
});
