/** État d'une simulation : un contact fictif face au vrai moteur. */
import {
  DEFAULT_CHANNEL_SETTINGS,
  runEngine,
  type ChannelConfig,
  type ClientContext,
  type ContactState,
  type EngineInput,
  type EngineResult,
  type Flow,
  type InfoSheet,
  type OutgoingMessage,
  type Session,
  type TriggerMode,
} from "@/engine";
import { explainTurn, describeIncoming, type JournalLine } from "./explain";

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
  return { id: "simulateur", clientId: bot.client.id, triggerMode: bot.triggerMode, ...DEFAULT_CHANNEL_SETTINGS };
}

/** Joue un message entrant : moteur réel, puis conversation et journal mis à jour. */
export async function playTurn(state: SimState, bot: Bot, message: EngineInput["message"], chatText?: string): Promise<{ state: SimState; result: EngineResult }> {
  const input: EngineInput = {
    now: new Date(state.now),
    client: bot.client,
    channel: channelFor(bot),
    flows: bot.flows,
    infoSheet: bot.infoSheet,
    contact: state.contact,
    session: state.session,
    message,
  };
  const result = await runEngine(input);
  const at = state.now;
  const chat = [...state.chat];
  if (message.kind === "text" || message.kind === "button_reply" || message.kind === "list_reply") {
    chat.push({ id: uid(), from: "client", text: chatText ?? (message.kind === "text" ? message.text : message.title), at });
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
