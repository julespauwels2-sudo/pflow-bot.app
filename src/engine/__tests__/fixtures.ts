import type {
  AiDecision,
  AiPort,
  AiRequest,
  ChannelConfig,
  ClientContext,
  ContactState,
  EngineInput,
  Flow,
  FlowEdge,
  FlowNode,
  InfoSheet,
  NodeDataMap,
  NodeType,
} from "../types";
import { DEFAULT_CHANNEL_SETTINGS } from "../types";

export function node<T extends NodeType>(id: string, type: T, data: NodeDataMap[T]): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as FlowNode;
}

/** Bloc Message d'une seule bulle de texte. */
export function say(id: string, text: string): FlowNode {
  return node(id, "message", { bubbles: [{ id: `${id}-1`, text, buttons: [] }] });
}

/** Bloc Message d'une bulle avec des boutons de réponse. */
export function ask(id: string, text: string, buttons: { id: string; title: string }[]): FlowNode {
  return node(id, "message", { bubbles: [{ id: `${id}-1`, text, buttons: buttons.map((b) => ({ ...b, kind: "reply" as const })) }] });
}

export function edge(source: string, target: string, sourceHandle: string | null = null): FlowEdge {
  return { id: `${source}-${sourceHandle ?? "next"}-${target}`, source, target, sourceHandle };
}

export const client: ClientContext = {
  id: "client_mexico",
  nomResto: "Mexico",
  orderSlug: "mexico",
  timezone: "America/Guadeloupe",
};

export const channel: ChannelConfig = {
  id: "canal_mexico",
  clientId: client.id,
  triggerMode: "mots_cles_uniquement",
  ...DEFAULT_CHANNEL_SETTINGS,
};

export const infoSheet: InfoSheet = {
  horaires: [
    { jour: 2, plages: [{ de: "11:00", a: "14:00" }] },
    { jour: 5, plages: [{ de: "18:00", a: "02:00" }] },
    { jour: 6, plages: [{ de: "11:00", a: "14:00" }, { de: "18:00", a: "23:00" }] },
    { jour: 7, plages: [{ de: "11:00", a: "15:00" }] },
  ],
  adresse: "12 rue Frébault, Pointe-à-Pitre",
  livraison: true,
  retrait: true,
};

/** Accueil → boutons (Commander / Nos horaires / Une question). */
export const accueil: Flow = {
  id: "f_accueil",
  name: "Accueil",
  description: "Accueil et lien de commande",
  nodes: [
    node("t", "trigger", { keywords: ["commander", "bonjour", "menu"] }),
    say("m", "Bonjour {{prenom}} 👋 Bienvenue chez {{nom_resto}} !"),
    ask("b", "Que souhaitez-vous faire ?", [
      { id: "cmd", title: "Commander" },
      { id: "hor", title: "Nos horaires" },
      { id: "q", title: "Une question" },
    ]),
    node("lien", "message", {
      bubbles: [{ id: "lien-1", text: "Pour commander, c'est par ici 👇", buttons: [{ id: "go", kind: "link", title: "Commander", orderLink: true }] }],
    }),
    node("fin", "end", { text: "Bon appétit !" }),
    say("hor", "Nous sommes ouverts du mardi au dimanche."),
    node("ia", "ai", { intro: "Posez-moi votre question 🙂", instructions: "Sois bref." }),
  ],
  edges: [
    edge("t", "m"),
    edge("m", "b"),
    edge("b", "lien", "cmd"),
    edge("lien", "fin"),
    edge("b", "hor", "hor"),
    edge("b", "ia", "q"),
  ],
};

/** L'agneau n'est dispo que le week-end. */
export const agneau: Flow = {
  id: "f_agneau",
  name: "Agneau",
  nodes: [
    node("t", "trigger", { keywords: ["agneau"] }),
    node("c", "condition", { rules: [{ kind: "jour", jours: [6, 7] }] }),
    say("oui", "Oui, l'agneau est dispo aujourd'hui !"),
    say("non", "L'agneau n'est disponible que le week-end."),
  ],
  edges: [edge("t", "c"), edge("c", "oui", "vrai"), edge("c", "non", "faux")],
};

/** Réservation : nombre de couverts puis téléphone. */
export const reservation: Flow = {
  id: "f_resa",
  name: "Réservation",
  nodes: [
    node("t", "trigger", { keywords: ["réservation", "reserver"] }),
    node("q1", "question", { text: "Pour combien de personnes ?", variable: "couverts", validation: "nombre" }),
    node("q2", "question", { text: "Votre numéro ?", variable: "tel", validation: "telephone" }),
    say("ok", "C'est noté : {{couverts}} personnes, on vous rappelle au {{tel}}."),
    node("h", "handoff", { text: "Je passe la main à l'équipe." }),
  ],
  edges: [edge("t", "q1"), edge("q1", "q2", "next"), edge("q1", "h", "echec"), edge("q2", "ok")],
};

export const aide: Flow = {
  id: "f_aide",
  name: "Aide",
  nodes: [node("t", "trigger", { keywords: ["aide"] }), node("g", "goto_flow", { flowId: "f_accueil" })],
  edges: [edge("t", "g")],
};

export const flows = [accueil, agneau, reservation, aide];

export function freshContact(overrides: Partial<ContactState> = {}): ContactState {
  return {
    id: "+590690000000",
    profileName: "Jules",
    pause: null,
    aiUsage: { day: "", calls: 0 },
    ...overrides,
  };
}

/** Mardi 3 novembre 2026, 12:00 en Guadeloupe (UTC-4). */
export const NOW = new Date("2026-11-03T16:00:00Z");

export function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    now: NOW,
    client,
    channel,
    flows,
    infoSheet,
    contact: freshContact(),
    session: null,
    message: { kind: "text", text: "salut" },
    ...overrides,
  };
}

/** Faux port IA : renvoie la décision donnée et garde les requêtes reçues. */
export function fakeAi(decision: AiDecision | ((req: AiRequest) => AiDecision)) {
  const calls: AiRequest[] = [];
  const port: AiPort = async (req) => {
    calls.push(req);
    return {
      decision: typeof decision === "function" ? decision(req) : decision,
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  };
  return { port, calls };
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
