/**
 * Bots des restos (21 novembre 2026, soir de bascule) : mots-clés, transfert levé par un mot-clé, pause « l'équipe a
 * répondu », accueil complet, messages ignorés. Sur le vrai modèle maître (Accueil avec « commande » et « commander »).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_SETTINGS, runEngine, type ContactState, type EngineResult, type Flow, type Session, type TriggerMode } from "@/engine";
import { createLocalRepositories } from "../local/repositories";
import { createMemoryStore } from "../local/store";
import { createMasterTemplate } from "../template-seed";
import { toEngineFlow } from "../types";

const T0 = new Date("2026-11-21T22:00:00Z"); // samedi, 18 h en Guadeloupe
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const WELCOME = /^👋 Hello Naomi ! Bienvenue chez Mexico 🌯 Une petite faim \?/;
const textOf = (m: EngineResult["outgoing"][number]) => ("text" in m ? m.text : "");
const sent = (r: EngineResult) => r.outgoing.filter((m) => m.kind !== "typing");

async function masterFlows(): Promise<Flow[]> {
  const repos = createLocalRepositories(createMemoryStore());
  const template = await createMasterTemplate(repos);
  const flows = (await repos.flows.listByOwner(template.id)).map(toEngineFlow).filter((f): f is Flow => f !== null);
  // Comme en production depuis le 21 novembre (Accueil v5) : « commander » et « commande » ouvrent l'Accueil.
  const accueil = flows.find((f) => f.name === "Accueil")!.nodes.find((n) => n.type === "trigger");
  expect(accueil?.type === "trigger" && accueil.data.keywords).toEqual(expect.arrayContaining(["commande", "commander"]));
  return flows;
}

/** Une conversation suivie message après message (état du contact et session gardés). */
async function conversation(opts: { mode?: TriggerMode; numeroPflow?: boolean; ai?: boolean } = {}) {
  const flows = await masterFlows();
  let contact: ContactState = { id: "590690000001", profileName: "Naomi", pause: null, aiUsage: { day: "", calls: 0 } };
  let session: Session | null = null;
  const aiCalls: string[] = [];
  const play = async (message: Parameters<typeof runEngine>[0]["message"], at: Date) => {
    const r = await runEngine(
      {
        now: at,
        client: { id: "mx", nomResto: "Mexico", orderSlug: "mexico", timezone: "America/Guadeloupe" },
        channel: { id: "ch", clientId: "mx", triggerMode: opts.mode ?? "mots_cles_uniquement", ...DEFAULT_CHANNEL_SETTINGS, ...(opts.numeroPflow ? { numeroPflow: true } : {}) },
        flows,
        infoSheet: { horaires: [], livraison: false, retrait: true, emojiAccueil: "🌯" },
        contact,
        session,
        message,
      },
      opts.ai === false
        ? {}
        : {
            ai: async (req) => {
              aiCalls.push(req.message);
              return { decision: { action: "repondre", texte: "Oui, on a des quesadillas 😋", sujet: "carte" }, usage: { inputTokens: 1, outputTokens: 1 } };
            },
          },
    );
    contact = r.contact;
    session = r.session;
    return r;
  };
  return {
    say: (text: string, at: Date) => play({ kind: "text", text }, at),
    echo: (text: string, at: Date) => play({ kind: "echo", text }, at),
    handoff: (at: Date) => {
      contact = { ...contact, pause: { reason: "transfert_humain", until: new Date(at.getTime() + 24 * 3_600_000).toISOString() } };
    },
    get contact() {
      return contact;
    },
    aiCalls,
  };
}

describe("mots-clés des bots des restos", () => {
  it("« Commande » seul ouvre l'accueil complet, quelle que soit l'écriture (majuscules, accents, ponctuation, emojis)", async () => {
    for (const text of ["Commande", "commande", "COMMANDE !!!", "Commandé 🍔", "  commande.  ", "Commander", "Menu ?", "bonjour 👋"]) {
      const c = await conversation();
      const r = await c.say(text, T0);
      expect(textOf(sent(r)[0]!), text).toMatch(WELCOME);
      expect(sent(r)[0]).toMatchObject({ kind: "link", buttonLabel: "Commander", url: "https://order.pflow.fr/c/mexico" });
      expect(textOf(sent(r).at(-1)!), text).toMatch(/^✨ Besoin d'un petit coup de main/);
    }
  });

  it("« commander » (aussi mot-clé de « CTA - Commander ») : l'Accueil gagne ; « je commande » reste au CTA", async () => {
    const c = await conversation();
    expect(textOf(sent(await c.say("commander", T0))[0]!)).toMatch(WELCOME);
    const cta = await c.say("je commande", min(1));
    expect(sent(cta)[0]).toMatchObject({ kind: "link", buttonLabel: "😋 Je commande" });
  });

  it("« Bonjour, je viens de passer la commande » (client réel, 18 h 22) : accueil complet en mode mots-clés", async () => {
    const c = await conversation();
    const r = await c.say("Bonjour, je viens de passer la commande n° 35 au nom de Sylvie", T0);
    expect(textOf(sent(r)[0]!)).toMatch(WELCOME);
    // Phrases qui commencent par un mot-clé, ou salutation + vrai mot-clé.
    for (const text of ["Commande pour ce soir svp", "Bonsoir, c'est quoi vos horaires ?", "Salut ! Je voudrais commander pour 20h"]) {
      const other = await conversation();
      expect(sent(await other.say(text, T0)).length, text).toBeGreaterThan(0);
    }
  });

  it("message perso sans mot-clé : ignoré (raison « aucun_declencheur »), jamais de réponse", async () => {
    for (const text of ["Salut tu viens ce soir ?", "Bonjour madame comment allez-vous", "Tu as vu le match hier soir avec les gars ?", "Ok merci 🙏", "Bonjour " + "je ".repeat(20) + "commande"]) {
      const c = await conversation();
      const r = await c.say(text, T0);
      expect(sent(r), text).toEqual([]);
      expect(r.events.some((e) => e.type === "ignored" && e.reason === "aucun_declencheur"), text).toBe(true);
    }
  });

  it("transfert, puis « Bonjour » : le bot reprend (transfert levé, accueil complet), puis répond à la question", async () => {
    const c = await conversation();
    await c.say("bonjour", T0);
    c.handoff(min(1));
    const silent = await c.say("Vous avez des quesadillas ?", min(5));
    expect(sent(silent)).toEqual([]);
    expect(silent.events).toContainEqual({ type: "ignored", reason: "pause" });
    const back = await c.say("Bonjour", min(10));
    expect(back.events).toContainEqual({ type: "pause_lifted", by: "mot_cle", keyword: "bonjour" });
    expect(c.contact.pause).toBeNull();
    expect(textOf(sent(back)[0]!)).toMatch(WELCOME);
    const answer = await c.say("Vous avez des quesadillas ?", min(11));
    expect(c.aiCalls).toEqual(["Vous avez des quesadillas ?"]);
    expect(textOf(sent(answer)[0]!)).toBe("Oui, on a des quesadillas 😋");
  });

  it("l'équipe a répondu à la main : « Bonjour » ne réveille pas le bot pendant 12 h (même pendant un transfert)", async () => {
    const c = await conversation();
    c.handoff(T0);
    await c.echo("Bonsoir, je regarde ça", min(5));
    expect(c.contact.pause).toEqual({ reason: "echo_gerant", until: new Date(min(5).getTime() + 12 * 3_600_000).toISOString() });
    const r = await c.say("Bonjour", min(30));
    expect(sent(r)).toEqual([]);
    expect(r.events).toContainEqual({ type: "ignored", reason: "pause" });
    // 12 h après la dernière réponse de l'équipe : le bot reprend.
    const later = await c.say("Bonjour", min(5 + 12 * 60 + 1));
    expect(textOf(sent(later)[0]!)).toMatch(WELCOME);
  });

  it("« Bonjour » deux fois dans la journée : l'accueil complet les deux fois (jamais « Que puis-je faire pour vous ? »)", async () => {
    const c = await conversation();
    const first = await c.say("Bonjour", T0);
    const second = await c.say("Bonjour", min(120));
    for (const r of [first, second]) {
      expect(textOf(sent(r)[0]!)).toMatch(WELCOME);
      expect(sent(r).some((m) => textOf(m).startsWith("Que puis-je faire"))).toBe(false);
    }
    // Mode « toujours » (Cookies) : pareil.
    const t = await conversation({ mode: "toujours" });
    await t.say("Bonjour", T0);
    expect(textOf(sent(await t.say("Bonjour", min(60)))[0]!)).toMatch(WELCOME);
  });

  it("mode « toujours » (Cookies) : une phrase ou une question avec un mot-clé va à l'IA, comme avant", async () => {
    const c = await conversation({ mode: "toujours" });
    await c.say("Bonjour, je viens de passer la commande", T0);
    await c.say("ma commande est où ?", min(1));
    expect(c.aiCalls).toEqual(["Bonjour, je viens de passer la commande", "ma commande est où ?"]);
    // Mode mots-clés (Mexico) : pas d'IA pour les questions, l'accueil plutôt que le silence.
    const m = await conversation();
    expect(textOf(sent(await m.say("ma commande est où ?", T0))[0]!)).toMatch(WELCOME);
  });

  it("numéro PFlow (démos) : inchangé (transfert non levé par « Bonjour », menu court au 2e « Bonjour »)", async () => {
    const c = await conversation({ mode: "toujours", numeroPflow: true });
    await c.say("Bonjour", T0);
    const again = await c.say("Bonjour", min(5));
    expect(sent(again)[0]).toMatchObject({ kind: "buttons", text: "Que puis-je faire pour vous ? 👇" });
    c.handoff(min(6));
    const paused = await c.say("Bonjour", min(10));
    expect(sent(paused)).toEqual([]);
    expect(c.contact.pause?.reason).toBe("transfert_humain");
  });
});
