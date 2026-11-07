/** État d'une simulation : un contact fictif face au vrai moteur. */
import {
  DEFAULT_CHANNEL_SETTINGS,
  runEngine,
  type AgentConfig,
  type ChannelConfig,
  type ClientContext,
  type ContactState,
  type EngineDeps,
  type EngineInput,
  type EngineResult,
  type Flow,
  type InfoSheet,
  type OrderBridge,
  type OutgoingMessage,
  type Session,
  type TriggerMode,
} from "@/engine";
import { explainTurn, describeIncoming, type JournalLine } from "./explain";

/** Pont PFlow Order du simulateur : réponses d'exemple, clairement marquées. */
export const simulatedOrderBridge: OrderBridge = async ({ action }) =>
  action === "suivi"
    ? { ok: true, code: "OK", trouve: true, statut: "en_preparation", numero: "1042", texte: "🧪 (Simulation) Votre commande n° 1042 (32 €) est en préparation." }
    : { ok: true, code: "ANNULATION_ANNULEE", texte: "🧪 (Simulation) Votre commande n° 1042 est annulée. Vous êtes remboursé intégralement, sous 5 à 10 jours sur votre compte." };

export type ChatEntry =
  | { id: string; from: "client"; text: string; at: string }
  | { id: string; from: "gerant"; text: string; at: string }
  | { id: string; from: "bot"; message: OutgoingMessage; at: string }
  | { id: string; from: "system"; text: string; at: string };

export interface Turn {
  id: string;
  at: string;
  incoming: string;
  lines: JournalLine[];
  /** Blocs exécutés pendant ce tour (surlignage). */
  steps: { flowId: string; nodeId: string }[];
}

export interface SimState {
  now: string;
  contact: ContactState;
  session: Session | null;
  chat: ChatEntry[];
  turns: Turn[];
}

export interface Bot {
  client: ClientContext;
  flows: Flow[];
  infoSheet: InfoSheet;
  triggerMode: TriggerMode;
  /** Agent IA du modèle (consigne, fonctions). */
  agent?: AgentConfig;
  /** Appels IA maximum par contact et par jour. */
  aiDailyLimit?: number;
}

let counter = 0;
const uid = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newSimulation(now: Date, profileName = "Léa"): SimState {
  return {
    now: now.toISOString(),
    contact: { id: "simulateur", profileName, pause: null, aiUsage: { day: "", calls: 0 } },
    session: null,
    chat: [],
    turns: [],
  };
}

export function channelFor(bot: Bot): ChannelConfig {
  return {
    id: "simulateur",
    clientId: bot.client.id,
    triggerMode: bot.triggerMode,
    ...DEFAULT_CHANNEL_SETTINGS,
    aiDailyLimitPerContact: bot.aiDailyLimit ?? DEFAULT_CHANNEL_SETTINGS.aiDailyLimitPerContact,
  };
}

/** Message du client affiché tout de suite, avant la réponse du bot (l'IA peut prendre 1 ou 2 s). */
export function pendingClientEntry(state: SimState, message: EngineInput["message"], chatText?: string): ChatEntry | null {
  if (message.kind !== "text" && message.kind !== "button_reply" && message.kind !== "list_reply") return null;
  return { id: uid(), from: "client", text: chatText ?? (message.kind === "text" ? message.text : message.title), at: state.now };
}

/** Joue un message entrant : moteur réel, puis conversation et journal mis à jour. */
export async function playTurn(
  state: SimState,
  bot: Bot,
  message: EngineInput["message"],
  chatText?: string,
  deps: EngineDeps = {},
): Promise<{ state: SimState; result: EngineResult }> {
  const input: EngineInput = {
    now: new Date(state.now),
    client: bot.client,
    channel: channelFor(bot),
    flows: bot.flows,
    infoSheet: bot.infoSheet,
    contact: state.contact,
    session: state.session,
    message,
    agent: bot.agent,
  };
  // Bloc Commande (suivi, annulation) : réponses d'exemple, jamais d'appel à PFlow Order depuis le simulateur.
  const result = await runEngine(input, { orderBridge: simulatedOrderBridge, ...deps });
  const at = state.now;
  const chat = [...state.chat];
  const clientEntry = pendingClientEntry(state, message, chatText);
  if (clientEntry) {
    chat.push(clientEntry);
  } else if (message.kind === "unsupported") {
    chat.push({ id: uid(), from: "client", text: "🎤 Message vocal", at });
  } else if (message.kind === "echo") {
    chat.push({ id: uid(), from: "gerant", text: message.text || "(message du gérant)", at });
  } else {
    chat.push({ id: uid(), from: "system", text: describeIncoming(message), at });
  }
  for (const m of result.outgoing) chat.push({ id: uid(), from: "bot", message: m, at });

  const turn: Turn = {
    id: uid(),
    at,
    incoming: describeIncoming(message),
    lines: explainTurn(input, result),
    steps: result.events.flatMap((e) => (e.type === "step" ? [{ flowId: e.flowId, nodeId: e.nodeId }] : [])),
  };
  return {
    state: { ...state, contact: result.contact, session: result.session, chat, turns: [...state.turns, turn] },
    result,
  };
}

/** Ligne d'information dans le chat (temps qui avance, heure réglée…). */
export function withSystemLine(state: SimState, text: string): SimState {
  return { ...state, chat: [...state.chat, { id: uid(), from: "system", text, at: state.now }] };
}

export function advanceTime(state: SimState, minutes: number): SimState {
  return { ...state, now: new Date(Date.parse(state.now) + minutes * 60_000).toISOString() };
}
