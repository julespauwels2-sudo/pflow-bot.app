/**
 * Pause intelligente (22 novembre 2026) : après une réponse de l'équipe, le bot se tait ; si le client réécrit et que
 * personne ne répond dans le délai de la fiche (10 min par défaut), la tâche planifiée fait répondre le bot, qui lit
 * la conversation récente et ne contredit jamais l'équipe. Vrai processeur, vrai modèle maître, faux envoi.
 */
import { describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import type { AiRequest, InfoSheet, OutgoingMessage } from "@/engine";
import { buildPrompt, REPRISE_RULES } from "@/ai/prompt";
import { loadBotFromWorkspace } from "../bot-loader";
import { messageText } from "../inbox";
import { createMemoryChannelStore } from "../memory-store";
import { processEvents, processReprises } from "../processor";
import type { Canal, InboundEvent } from "../types";

const T0 = new Date("2026-11-22T22:00:00Z"); // samedi soir en Guadeloupe
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const CLIENT = "590690115668";

async function setup(opts: { triggerMode?: Canal["triggerMode"]; role?: Canal["role"]; fiche?: Partial<InfoSheet> } = {}) {
  let clock = T0;
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
  await repos.bots.link(client.id, template.id);
  if (opts.fiche) await repos.infoSheets.save(client.id, { horaires: [], ...opts.fiche });
  const workspace = await repos.workspace.exportAll();
  const canal: Canal = {
    id: "canal1",
    restaurantId: client.id,
    plateforme: "whatsapp",
    accountId: "1000000001",
    wabaId: "WABA",
    triggerMode: opts.triggerMode ?? "mots_cles_uniquement",
    coexistence: true,
    echoPauseHours: 12,
    handoffPauseHours: 24,
    sessionMinutes: 30,
    etat: "actif",
    testNumeros: [],
    ...(opts.role ? { role: opts.role } : {}),
  };
  const store = createMemoryChannelStore([canal], { now: () => clock });
  const sent: OutgoingMessage[] = [];
  const graph = { send: async (_a: string, _to: string, m: OutgoingMessage) => (sent.push(m), `wamid.out${sent.length}`), markRead: async () => {} };
  const aiRequests: AiRequest[] = [];
  const deps = {
    store,
    graph,
    loadBot: async (id: string) => loadBotFromWorkspace(workspace, id),
    now: () => clock,
    sleep: async () => {},
    ai: async (req: AiRequest) => {
      aiRequests.push(req);
      return { decision: { action: "repondre" as const, texte: "Je vous conseille le burrito poulet, sans crème 😋", sujet: "carte" as const }, usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  let n = 0;
  const event = (message: InboundEvent["message"]): InboundEvent => ({
    plateforme: "whatsapp",
    accountId: canal.accountId,
    waId: CLIENT,
    profileName: "Naomi",
    wamid: `wamid.in${++n}`,
    timestamp: String(Math.floor(clock.getTime() / 1000)),
    message,
    type: "text",
    contenu: { texte: "text" in message ? message.text : "" },
  });
  const client_ = async (text: string, when: Date) => {
    clock = when;
    return processEvents({ inbound: [event({ kind: "text", text })], statuses: [] }, deps);
  };
  const equipe = async (text: string, when: Date) => {
    clock = when;
    return processEvents({ inbound: [event({ kind: "echo", text })], statuses: [] }, deps);
  };
  const cron = async (when: Date) => {
    clock = when;
    return processReprises(store, () => deps, when, messageText);
  };
  const contact = async () => (await store.listContacts("canal1"))[0]!;
  return { store, sent, aiRequests, client: client_, equipe, cron, contact, deps, setClock: (d: Date) => (clock = d) };
}

const texts = (sent: OutgoingMessage[]) => sent.map((m) => ("text" in m ? m.text : ""));

describe("pause intelligente après une réponse de l'équipe", () => {
  it("l'équipe répond, le client écrit, l'équipe répond à 5 min : le bot reste silencieux (même après 10 min)", async () => {
    const s = await setup();
    await s.equipe("Bonsoir, oui c'est ouvert", T0);
    await s.client("Super, vous avez encore de l'agneau ?", at(1));
    expect(s.sent).toEqual([]);
    expect((await s.contact()).state.pause).toEqual({ reason: "echo_gerant", until: at(11).toISOString() });
    await s.equipe("Oui il en reste 😊", at(5));
    // Le délai repart de la dernière réponse de l'équipe : plus de client en attente.
    expect((await s.contact()).state.pause?.until).toBe(at(5 + 12 * 60).toISOString());
    const report = await s.cron(at(12));
    expect(report.reprises).toBe(0);
    expect(s.sent).toEqual([]);
    expect(s.aiRequests).toEqual([]);
  });

  it("le client écrit et personne ne répond pendant 10 min : le bot répond, avec la conversation récente ; puis bot actif", async () => {
    const s = await setup();
    await s.client("Commande", at(-30)); // le bot a déjà parlé à ce client (accueil)
    s.sent.length = 0;
    await s.equipe("Bonsoir Naomi, je regarde votre commande", T0);
    await s.client("Merci ! Et vous avez des desserts ?", at(2));
    await s.client("Pour 2 personnes", at(3));
    expect((await s.cron(at(9))).reprises).toBe(0); // pas encore l'heure (2 + 10 = 12)
    expect(s.sent).toEqual([]);
    const report = await s.cron(at(12) /* 2 + 10 min */);
    expect(report).toMatchObject({ reprises: 1, erreurs: [] });
    expect(s.aiRequests).toHaveLength(1);
    const req = s.aiRequests[0]!;
    expect(req.message).toBe("Merci ! Et vous avez des desserts ?\nPour 2 personnes");
    expect(req.conversation?.slice(-3)).toEqual([
      { role: "equipe", text: "Bonsoir Naomi, je regarde votre commande" },
      { role: "client", text: "Merci ! Et vous avez des desserts ?" },
      { role: "client", text: "Pour 2 personnes" },
    ]);
    expect(texts(s.sent)[0]).toBe("Je vous conseille le burrito poulet, sans crème 😋");
    expect(s.sent[1]).toMatchObject({ kind: "link", buttonLabel: "Commander" });
    // Bot actif ensuite, jusqu'à la prochaine réponse de l'équipe.
    expect((await s.contact()).state.pause).toBeNull();
    // Une seconde passe de la tâche (ou deux en même temps) ne répond jamais deux fois.
    expect((await s.cron(at(12.5))).reprises).toBe(0);
    expect(s.sent).toHaveLength(2);
    // Le message suivant du client est traité normalement (mot-clé → accueil).
    await s.client("Bonjour", at(20));
    expect(texts(s.sent).some((t) => t.startsWith("👋 Hello Naomi ! Bienvenue chez Mexico"))).toBe(true);
  });

  it("l'équipe a dit « on n'a plus de crème » puis le client demande une recommandation : l'IA le sait et a la consigne", async () => {
    const s = await setup({ triggerMode: "toujours" });
    await s.equipe("Désolé, on n'a plus de crème ce soir", T0);
    await s.client("Ok, vous me conseillez quoi alors ?", at(1));
    await s.cron(at(11));
    const req = s.aiRequests[0]!;
    const context = buildPrompt(req).system.find((b) => b.title === "Contexte")!.text;
    expect(context).toContain(REPRISE_RULES);
    expect(REPRISE_RULES).toContain("« on n'a plus de crème » : ne propose jamais de crème");
    expect(context).toContain("Équipe (à la main) : Désolé, on n'a plus de crème ce soir");
    expect(context).toContain("Client : Ok, vous me conseillez quoi alors ?");
  });

  it("délai réglable dans la fiche du resto (ici 3 min)", async () => {
    const s = await setup({ fiche: { repriseMinutes: 3 }, triggerMode: "toujours" });
    await s.equipe("Bonsoir", T0);
    await s.client("Vous livrez à Jarry ?", at(1));
    expect((await s.contact()).state.pause?.until).toBe(at(4).toISOString());
    expect((await s.cron(at(4))).reprises).toBe(1);
  });

  it("le client n'écrit pas : le bot ne dit rien (même après 10 min) ; 12 h plus tard, il répond normalement", async () => {
    const s = await setup();
    await s.equipe("Votre commande est prête !", T0);
    expect((await s.cron(at(15))).reprises).toBe(0);
    expect(s.sent).toEqual([]);
    await s.client("Bonjour", at(12 * 60 + 1));
    expect(texts(s.sent)[0]).toMatch(/^👋 Hello Naomi ! Bienvenue chez Mexico/);
  });

  it("numéro « mots-clés uniquement » : un ami du gérant (le bot ne lui a jamais parlé) n'a jamais de réponse du bot", async () => {
    const s = await setup();
    await s.equipe("Salut, tu viens ce soir ?", T0);
    await s.client("Grave, j'arrive vers 21h", at(1));
    expect((await s.cron(at(11))).reprises).toBe(0);
    expect(s.sent).toEqual([]);
    expect(s.aiRequests).toEqual([]);
  });

  it("numéro « mots-clés uniquement » : un client que le bot ne connaît pas écrit « Commande » pendant la pause : le bot reprend à 10 min", async () => {
    const s = await setup();
    await s.equipe("Salut Teddy, merci pour ton soutien", T0);
    await s.client("Commande", at(60));
    expect(s.sent).toEqual([]);
    expect((await s.cron(at(65))).reprises).toBe(0); // pas encore l'heure
    const report = await s.cron(at(70));
    expect(report).toMatchObject({ reprises: 1, erreurs: [] });
    expect(texts(s.sent)[0]).toMatch(/Bienvenue chez Mexico/);
  });

  it("transfert inchangé : la tâche ne reprend jamais un client en attente de l'équipe après un transfert", async () => {
    const s = await setup();
    await s.client("bonjour", T0);
    const c = await s.contact();
    await s.store.saveContact({ ...c, state: { ...c.state, pause: { reason: "transfert_humain", until: at(24 * 60).toISOString() } } });
    const before = s.sent.length;
    await s.client("Vous êtes là ?", at(1));
    expect((await s.cron(at(30))).reprises).toBe(0);
    expect(s.sent.length).toBe(before);
    expect((await s.contact()).state.pause?.reason).toBe("transfert_humain");
  });

  it("numéro PFlow (démos) : inchangé, la pause « l'équipe a répondu » dure 12 h, aucune reprise", async () => {
    const s = await setup({ role: "pflow", triggerMode: "toujours" });
    await s.equipe("Bonsoir, c'est Jules", T0);
    await s.client("Super merci", at(1));
    expect((await s.contact()).state.pause?.until).toBe(at(12 * 60).toISOString());
    expect((await s.cron(at(15))).reprises).toBe(0);
  });
});
