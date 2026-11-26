/**
 * Suivi d'une commande passée sur la page SANS passer par le bot (25 novembre 2026, demande de Mexico). Le client
 * touche « Recevoir le suivi sur WhatsApp » et envoie « Suivi de ma commande n° 12 (réf. a1b2c3) » :
 * - le bot ne lance ni l'accueil ni l'IA (mode « toujours » comme « mots-clés uniquement », même en pause) ;
 * - il demande à PFlow Order de relier la commande (pont, action suivi_web) ;
 * - PFlow Order rejoue les événements (ici simulé : le vrai handleOrderEvent, comme /api/webhooks/pflow-order) :
 *   la confirmation part par le flux « Commande validée », puis les étapes suivantes ;
 * - si PFlow Order n'a rien envoyé (commande terminée, introuvable), son texte part ; injoignable : texte de repli.
 * Vrai processeur, vrai modèle maître, faux envoi.
 */
import { describe, expect, it } from "vitest";
import { createLocalRepositories } from "@/data/local/repositories";
import { createMemoryStore } from "@/data/local/store";
import { createMasterTemplate } from "@/data/template-seed";
import type { OrderBridge, OrderBridgeRequest, OutgoingMessage } from "@/engine";
import { handleOrderEvent } from "@/channels/pflow-order/order-events";
import { loadBotFromWorkspace } from "../bot-loader";
import { createMemoryChannelStore } from "../memory-store";
import { FOLLOW_FALLBACK_TEXT, processEvents } from "../processor";
import type { Canal, InboundEvent } from "../types";

const T0 = new Date("2026-11-25T23:00:00Z"); // 19 h en Guadeloupe
const CLIENT = "590690115668";
const TEXTE = "Suivi de ma commande n° 12 (réf. a1b2c3)";

type Mode = "bridge_ok" | "bridge_texte" | "bridge_panne" | "sans_bridge";

async function setup(opts: { triggerMode?: Canal["triggerMode"]; bridge?: Mode } = {}) {
  const clock = T0;
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const client = await repos.clients.create({ nomResto: "Mexico", orderSlug: "mexico" });
  await repos.bots.link(client.id, template.id);
  const workspace = await repos.workspace.exportAll();
  const canal: Canal = {
    id: "canal1",
    restaurantId: "11111111-1111-4111-8111-111111111111",
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
  };
  const store = createMemoryChannelStore([canal], { now: () => clock });
  const sent: OutgoingMessage[] = [];
  const graph = { send: async (_a: string, _to: string, m: OutgoingMessage) => (sent.push(m), `wamid.out${sent.length}`), markRead: async () => {} };
  const loadBot = async () => loadBotFromWorkspace(workspace, client.id);
  const calls: OrderBridgeRequest[] = [];
  const mode = opts.bridge ?? "bridge_ok";
  // Le pont de PFlow Order : relie, puis rejoue les événements vers /api/webhooks/pflow-order (ici en direct).
  const orderBridge: OrderBridge = async (req) => {
    calls.push(req);
    if (mode === "bridge_panne") throw new Error("PFlow Order injoignable");
    if (mode === "bridge_texte") return { ok: true, envoye: false, trouve: true, texte: "C'est noté ✅ Votre commande n° 12 chez Mexico (14 €) est terminée. Merci et à bientôt !" };
    const r = await handleOrderEvent(
      {
        type: "commande",
        restaurant_id: canal.restaurantId,
        slug: "mexico",
        client_tel: req.tel,
        commande_id: "cmd-12",
        evenements: [{ pflow_order: "commande", pflow_bots: "commande_validee" }],
        variables: { client_nom: "Naomi", commande_numero: "12", commande_mode: "retrait", commande_recap: "1 Burrito Poulet", commande_total: "14 €", paiement_mode: "sur_place", commande_statut: "recue", commande_creneau: "Dès que possible", commande_delai: "20 min" },
      },
      { store, graph, loadBot, now: () => clock },
    );
    const envoye = r.pris && Object.values(r.envois).some((e) => e.etat === "ok");
    return { ok: true, envoye, trouve: true, texte: "C'est noté ✅ Votre commande n° 12 chez Mexico est bien reçue." };
  };
  const deps = {
    store,
    graph,
    loadBot,
    now: () => clock,
    sleep: async () => {},
    ...(mode === "sans_bridge" ? {} : { orderBridge }),
    ai: async () => ({ decision: { action: "repondre" as const, texte: "RÉPONSE IA", sujet: "carte" as const }, usage: { inputTokens: 1, outputTokens: 1 } }),
  };
  let n = 0;
  const send = (text: string, kind: "text" | "echo" = "text") => {
    const ev: InboundEvent = {
      plateforme: "whatsapp",
      accountId: canal.accountId,
      waId: CLIENT,
      profileName: "Naomi",
      wamid: `wamid.in${++n}`,
      timestamp: String(Math.floor(clock.getTime() / 1000)),
      message: kind === "echo" ? { kind: "echo", text } : { kind: "text", text },
      type: "text",
      contenu: { texte: text },
    };
    return processEvents({ inbound: [ev], statuses: [] }, deps);
  };
  const contact = async () => (await store.listContacts("canal1"))[0]!;
  return { store, sent, calls, send, contact };
}

const texts = (sent: OutgoingMessage[]) => sent.map((m) => ("text" in m ? m.text : "kind" in m ? `[${m.kind}]` : ""));

describe("suivi d'une commande passée sur la page (bouton « Recevoir le suivi sur WhatsApp »)", () => {
  for (const triggerMode of ["mots_cles_uniquement", "toujours"] as const) {
    it(`mode ${triggerMode} : la commande est reliée et la confirmation part (sans accueil ni IA)`, async () => {
      const s = await setup({ triggerMode });
      const r = await s.send(TEXTE);
      expect(r.errors).toEqual([]);
      expect(s.calls).toEqual([{ action: "suivi_web", slug: "mexico", tel: CLIENT, numero: "12", ref: "a1b2c3" }]);
      const all = texts(s.sent).join("\n");
      expect(all).toMatch(/12/);
      expect(all).not.toContain("RÉPONSE IA");
      expect(all).not.toContain("C'est noté");
      // Pas d'accueil : le premier message est celui du flux « Commande validée ».
      expect(s.sent.length).toBeGreaterThan(0);
      const msgs = await s.store.listMessages((await s.contact()).id);
      expect(msgs[0]).toMatchObject({ sens: "entrant", erreur: "ignore:suivi_commande" });
    });
  }

  it("commande déjà terminée (PFlow Order n'envoie rien) : le texte de PFlow Order part", async () => {
    const s = await setup({ triggerMode: "toujours", bridge: "bridge_texte" });
    await s.send(TEXTE);
    expect(texts(s.sent)).toEqual(["C'est noté ✅ Votre commande n° 12 chez Mexico (14 €) est terminée. Merci et à bientôt !"]);
  });

  it("PFlow Order injoignable ou pont absent : texte de repli, jamais l'accueil", async () => {
    for (const bridge of ["bridge_panne", "sans_bridge"] as const) {
      const s = await setup({ triggerMode: "toujours", bridge });
      await s.send(TEXTE);
      expect(texts(s.sent)).toEqual([FOLLOW_FALLBACK_TEXT("12")]);
    }
  });

  it("contact en pause (l'équipe a répondu) : la commande est quand même reliée, la pause reste", async () => {
    const s = await setup();
    await s.send("salut c'est l'équipe", "echo");
    const pause = (await s.contact()).state.pause;
    expect(pause?.reason).toBe("echo_gerant");
    await s.send(TEXTE);
    expect(s.calls).toHaveLength(1);
    expect(s.sent.length).toBeGreaterThan(0);
    expect((await s.contact()).state.pause?.reason).toBe("echo_gerant");
  });

  it("le message tapé autrement (sans référence, majuscules, emoji) est reconnu ; une vraie phrase ne l'est pas", async () => {
    const s = await setup({ triggerMode: "toujours", bridge: "bridge_texte" });
    await s.send("📦 SUIVI COMMANDE N°7");
    expect(s.calls.at(-1)).toEqual({ action: "suivi_web", slug: "mexico", tel: CLIENT, numero: "7" });
    const avant = s.calls.length;
    await s.send("je voudrais le suivi de ma commande n° 7 svp, elle arrive quand ?");
    expect(s.calls).toHaveLength(avant);
  });
});
