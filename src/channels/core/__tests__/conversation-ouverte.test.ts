/**
 * Conversation ouverte en mode mots-clés (22 novembre 2026, bug de Mexico) : après une réponse du bot, la conversation
 * reste ouverte 30 min (réglable dans la fiche) ; le client peut écrire librement, le bot ou l'IA répond. Vrai
 * processeur, vrai modèle maître, faux envoi.
 */
import { describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import type { AiRequest, InfoSheet, OutgoingMessage } from "@/engine";
import { loadBotFromWorkspace } from "../bot-loader";
import { messageText } from "../inbox";
import { createMemoryChannelStore } from "../memory-store";
import { processEvents, processReprises } from "../processor";
import type { Canal, InboundEvent } from "../types";

const T0 = new Date("2026-11-22T01:39:00Z"); // samedi 21 h 39 en Guadeloupe
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
      if (/parler à quelqu/i.test(req.message)) return { decision: { action: "fonction" as const, fonction: "parler_equipe", texte: "" }, usage: { inputTokens: 1, outputTokens: 1 } };
      return { decision: { action: "repondre" as const, texte: "Oui, le burrito poulet est dispo ce soir 😋", sujet: "carte" as const }, usage: { inputTokens: 1, outputTokens: 1 } };
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
const lastNote = async (s: Awaited<ReturnType<typeof setup>>) => (await s.store.listMessages((await s.contact()).id)).at(-1)?.erreur;

describe("conversation ouverte en mode mots-clés", () => {
  it("bug de Mexico : « Bonjour je souhaite passer commande » (lien), puis « Je veux parler à quelqu'un » 1 min après : le transfert part", async () => {
    const s = await setup();
    await s.client("Bonjour je souhaite passer commande", T0);
    expect(s.sent[0]).toMatchObject({ kind: "link", buttonLabel: "😋 Je commande" });
    const n = s.sent.length;
    const r = await s.client("Je veux parler à quelqu'un", at(1));
    // Seule erreur possible ici : l'alerte au gérant (pas de clés de notification dans les tests).
    expect(r.errors.filter((e) => !e.startsWith("Alerte non envoyée"))).toEqual([]);
    expect(s.aiRequests.map((q) => q.message)).toEqual(["Je veux parler à quelqu'un"]);
    expect(s.sent.length).toBeGreaterThan(n);
    expect(texts(s.sent.slice(n)).join(" ")).toMatch(/équipe/i);
    expect(await s.store.listTransferts("canal1")).toHaveLength(1);
    expect((await s.contact()).state.pause?.reason).toBe("transfert_humain");
    expect(await lastNote(s)).toBeUndefined();
  });

  it("question 20 min après le lien : l'IA répond ; la fenêtre repart à chaque réponse du bot", async () => {
    const s = await setup();
    await s.client("je commande", T0);
    s.sent.length = 0;
    await s.client("Vous avez du poulet ce soir ?", at(20));
    expect(texts(s.sent)[0]).toBe("Oui, le burrito poulet est dispo ce soir 😋");
    // Réponse du bot à 20 min : la conversation reste ouverte jusqu'à 50 min.
    await s.client("Et c'est combien ?", at(45));
    expect(s.aiRequests.map((q) => q.message)).toEqual(["Vous avez du poulet ce soir ?", "Et c'est combien ?"]);
  });

  it("message 40 min après la dernière réponse du bot : ignoré sans mot-clé (« ignore:aucun_declencheur »)", async () => {
    const s = await setup();
    await s.client("je commande", T0);
    s.sent.length = 0;
    await s.client("Vous êtes ouverts demain ?", at(40));
    expect(s.sent).toEqual([]);
    expect(s.aiRequests).toEqual([]);
    expect(await lastNote(s)).toBe("ignore:aucun_declencheur");
    // Un mot-clé marche toujours.
    await s.client("Menu", at(41));
    expect(texts(s.sent)[0]).toMatch(/^👋 Hello Naomi ! Bienvenue chez Mexico/);
  });

  it("délai réglable dans la fiche (ici 5 min)", async () => {
    const s = await setup({ fiche: { conversationOuverteMinutes: 5 } });
    await s.client("je commande", T0); // CTA : aucun bloc n'attend de réponse (pas de session)
    s.sent.length = 0;
    await s.client("Vous avez du poulet ?", at(4));
    expect(s.sent.length).toBeGreaterThan(0);
    s.sent.length = 0;
    await s.client("Et des desserts ?", at(4 + 6));
    expect(s.sent).toEqual([]);
  });

  it("un ami du gérant qui n'a jamais parlé au bot : toujours ignoré", async () => {
    const s = await setup();
    await s.client("Cimer boss", T0);
    await s.client("On se voit ce soir ?", at(1));
    expect(s.sent).toEqual([]);
    expect(s.aiRequests).toEqual([]);
    expect(await lastNote(s)).toBe("ignore:aucun_declencheur");
  });

  it("les pauses restent prioritaires : réponse de l'équipe pendant la fenêtre → silence, puis reprise après 10 min", async () => {
    const s = await setup();
    await s.client("Commande", T0);
    s.sent.length = 0;
    await s.equipe("Bonsoir, je m'occupe de vous", at(2));
    await s.client("Merci, c'est pour 2 burritos", at(3));
    expect(s.sent).toEqual([]);
    expect(await lastNote(s)).toBe("ignore:pause_echo_gerant");
    expect((await s.cron(at(13))).reprises).toBe(1);
    expect(texts(s.sent)[0]).toBe("Oui, le burrito poulet est dispo ce soir 😋");
  });

  it("mode « toujours » (Cookies) : inchangé, l'IA répond même sans réponse récente du bot", async () => {
    const s = await setup({ triggerMode: "toujours" });
    await s.client("Vous avez du poulet ce soir ?", T0);
    expect(s.aiRequests.map((q) => q.message)).toEqual(["Vous avez du poulet ce soir ?"]);
  });
});
