import { evaluateConditions } from "./conditions";
import { infoSheetVariables, withUpcomingRounds } from "./info-vars";
import { fixedDelayMs, smartDelayMs, textOf } from "./delay";
import { findDefaultFlow, findEventFlow, findTrigger, matchFlowByKeyword, normalize } from "./match";
import { canSendFreeform } from "./window";
import { decodeReplyId, encodeReplyId } from "./reply-id";
import { firstName, renderTemplate } from "./template";
import { localTime } from "./time";
import { validateAnswer } from "./validators";
import {
  DEFAULT_ORDER_BASE_URL,
  type ChoiceOption,
  type ContactState,
  type EngineDeps,
  type EngineEvent,
  type EngineInput,
  type EngineResult,
  type Flow,
  type FlowNode,
  type FlowNodeOf,
  type MessageBubble,
  type OutgoingMessage,
  type PauseReason,
  type QuestionValidation,
  type Session,
} from "./types";

/** Garde-fou contre les boucles (ex. deux « Aller à un flux » qui se renvoient l'un l'autre). */
export const MAX_STEPS_PER_MESSAGE = 50;
export const DEFAULT_MAX_RETRIES = 2;

export const TEXTS = {
  handoff: "Je transmets votre message à l'équipe, on vous répond très vite 🙏",
  unsupported:
    "Je ne peux lire que les messages écrits pour l'instant. Pouvez-vous m'écrire votre réponse ?",
  chooseOption: "Merci de choisir une des options ci-dessous 👇",
  orderLink: "Pour commander, c'est par ici 👇",
  orderButton: "Commander",
  questionError: {
    texte: "Je n'ai pas bien compris, pouvez-vous reformuler ?",
    nombre: "Merci d'indiquer un nombre (par exemple : 2).",
    telephone: "Ce numéro ne semble pas valide. Exemple : 0690 12 34 56",
    oui_non: "Répondez simplement par oui ou par non 🙂",
  } satisfies Record<QuestionValidation, string>,
};

type WaitingNode = FlowNodeOf<"message"> | FlowNodeOf<"list"> | FlowNodeOf<"question"> | FlowNodeOf<"ai">;

/** Boutons de réponse d'un bloc Message, toutes bulles confondues. */
export function replyButtonsOf(node: FlowNodeOf<"message">): ChoiceOption[] {
  return node.data.bubbles.flatMap((b) => b.buttons.flatMap((x) => (x.kind === "reply" ? [{ id: x.id, title: x.title }] : [])));
}

const hasReplyButtons = (node: FlowNode): boolean => node.type === "message" && replyButtonsOf(node).length > 0;

/** Options cliquables d'un bloc en attente (boutons ou liste). */
function optionsOf(node: WaitingNode): ChoiceOption[] | null {
  if (node.type === "message") return replyButtonsOf(node);
  if (node.type === "list") return node.data.items;
  return null;
}

/**
 * Traite un message entrant. Ne fait aucune entrée/sortie : le seul appel
 * externe possible est `deps.ai`, injecté par l'appelant (simulateur, webhook, tests).
 */
export async function runEngine(input: EngineInput, deps: EngineDeps = {}): Promise<EngineResult> {
  const run = new EngineRun(input, deps);
  await run.process();
  return run.result();
}

class EngineRun {
  private contact: ContactState;
  private session: Session | null;
  private outgoing: OutgoingMessage[] = [];
  private events: EngineEvent[] = [];
  private steps = 0;

  constructor(
    private readonly input: EngineInput,
    private readonly deps: EngineDeps,
  ) {
    this.contact = structuredClone(input.contact);
    this.session = input.session ? structuredClone(input.session) : null;
  }

  result(): EngineResult {
    return { contact: this.contact, session: this.session, outgoing: resolveDelays(this.outgoing), events: this.events };
  }

  // -------------------------------------------------------------------------
  // Point d'entrée
  // -------------------------------------------------------------------------

  async process(): Promise<void> {
    const { message, now } = this.input;

    // Le gérant a répondu lui-même depuis l'appli : le bot se tait pour ce contact.
    if (message.kind === "echo") {
      this.pause("echo_gerant", this.input.channel.echoPauseHours);
      this.session = null;
      return;
    }

    // Événement PFlow Order (commande validée, prête…) : ce n'est pas un message du contact.
    if (message.kind === "event") {
      this.processEvent(message.event, message.data);
      return;
    }

    this.contact.lastInboundAt = now.toISOString();

    // 1. Contact en pause : on ne fait rien.
    if (this.contact.pause) {
      const until = this.contact.pause.until;
      if (until === null || Date.parse(until) > now.getTime()) {
        this.events.push({ type: "ignored", reason: "pause" });
        return;
      }
      this.contact.pause = null;
      this.events.push({ type: "pause_expired" });
    }

    if (this.session && Date.parse(this.session.expiresAt) <= now.getTime()) {
      this.events.push({ type: "session_expired", flowId: this.session.flowId });
      this.session = null;
    }

    if (message.kind === "unsupported") {
      const waiting = this.currentWaitingNode();
      if (waiting) {
        this.send({ kind: "text", text: TEXTS.unsupported });
        this.sendPrompt(waiting);
        this.refreshExpiry();
      } else {
        this.events.push({ type: "ignored", reason: "media_non_gere" });
      }
      return;
    }

    // Clic sur un bouton ou une ligne de liste envoyés par le bot.
    if (message.kind === "button_reply" || message.kind === "list_reply") {
      if (this.handleReplyRef(message.id)) return;
    }

    const text = message.kind === "text" ? message.text : message.title;

    // 2. Session en cours qui attend une réponse : on continue le flux.
    const waiting = this.currentWaitingNode();
    if (waiting) {
      await this.handleWaiting(waiting, text);
      return;
    }
    this.session = null;

    // 3. Mot-clé d'un déclencheur : on lance le flux.
    const flow = matchFlowByKeyword(this.input.flows, text);
    if (flow) {
      this.startFlow(flow, "mot_cle");
      return;
    }

    // 4. Canal en mode « toujours » : flux par défaut s'il existe, sinon IA de secours.
    //    (Jamais sur un canal « mots-clés uniquement » : numéros perso des gérants.)
    if (this.input.channel.triggerMode === "toujours") {
      const defaultFlow = findDefaultFlow(this.input.flows);
      if (defaultFlow) {
        this.startFlow(defaultFlow, "defaut");
        return;
      }
      await this.callAi(text, {});
      return;
    }

    // 5. Mode « mots-clés uniquement » sans session : on ignore complètement.
    this.events.push({ type: "ignored", reason: "aucun_declencheur" });
  }

  /**
   * Règles des événements de commande :
   * - envoyés seulement si la fenêtre de 24 h est ouverte (pas de templates) ;
   * - envoyés même si le contact est en pause (transfert humain, gérant), sans lever la pause ;
   * - sans relancer le bot : la conversation en cours reprend ensuite telle quelle.
   */
  private processEvent(event: string, data: Record<string, string>): void {
    const { now, flows } = this.input;
    if (!canSendFreeform(this.contact, now)) {
      this.events.push({ type: "ignored", reason: "fenetre_fermee" });
      return;
    }
    const flow = findEventFlow(flows, event);
    if (!flow) {
      this.events.push({ type: "ignored", reason: "aucun_flux_evenement" });
      return;
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) if (typeof value === "string") vars[key] = value;
    if (event === "panier_abandonne" && !vars.lien_panier) vars.lien_panier = this.orderUrl() ?? "";

    const previous = this.session;
    this.startFlow(flow, "evenement", vars);
    if (!this.session) this.session = previous;
  }

  // -------------------------------------------------------------------------
  // Réponses en attente
  // -------------------------------------------------------------------------

  private handleReplyRef(replyId: string): boolean {
    const ref = decodeReplyId(replyId);
    if (!ref) return false;
    const flow = this.flow(ref.flowId);
    const node = flow?.nodes.find((n) => n.id === ref.nodeId);
    if (!flow || !node) return false;

    if (this.session?.flowId === ref.flowId) {
      // Même flux (ex. bouton d'une bulle précédente, l'étape suivante étant déjà partie) :
      // on garde la session et ses variables.
      this.session.nodeId = node.id;
    } else {
      // Ancien bouton (session expirée ou autre flux) : on reprend à cet endroit.
      this.session = this.newSession(flow.id, node.id);
      this.events.push({ type: "flow_started", flowId: flow.id, via: "bouton" });
    }
    this.followHandle(node, ref.handle);
    return true;
  }

  private async handleWaiting(node: WaitingNode, text: string): Promise<void> {
    switch (node.type) {
      case "message":
      case "list": {
        const options = optionsOf(node) ?? [];
        const option = matchOption(options, text);
        if (option) {
          this.followHandle(node, option.id);
          return;
        }
        if (this.tryKeyword(text)) return;
        await this.callAi(text, { repromptNode: node });
        return;
      }

      case "question": {
        const result = validateAnswer(text, node.data.validation);
        if (result.ok) {
          this.session!.vars[node.data.variable] = result.value;
          this.followHandle(node, "next");
          return;
        }
        if (this.tryKeyword(text)) return;
        const session = this.session!;
        session.retries += 1;
        if (session.retries > (node.data.maxRetries ?? DEFAULT_MAX_RETRIES)) {
          this.followHandle(node, "echec");
          return;
        }
        this.send({
          kind: "text",
          text: this.render(node.data.errorText || TEXTS.questionError[node.data.validation]),
        });
        this.sendPrompt(node);
        this.refreshExpiry();
        return;
      }

      case "ai": {
        if (this.tryKeyword(text)) return;
        await this.callAi(text, { instructions: node.data.instructions, stayInAiNode: true });
        return;
      }
    }
  }

  private tryKeyword(text: string): boolean {
    const flow = matchFlowByKeyword(this.input.flows, text);
    if (!flow) return false;
    this.startFlow(flow, "mot_cle");
    return true;
  }

  // -------------------------------------------------------------------------
  // IA de secours
  // -------------------------------------------------------------------------

  private async callAi(
    text: string,
    opts: { instructions?: string; repromptNode?: WaitingNode; stayInAiNode?: boolean },
  ): Promise<void> {
    const { ai } = this.deps;
    const { client, channel, now, flows, infoSheet } = this.input;

    if (!ai) {
      this.events.push({ type: "ai_unavailable" });
      if (opts.repromptNode) {
        this.send({ kind: "text", text: TEXTS.chooseOption });
        this.sendPrompt(opts.repromptNode);
        this.refreshExpiry();
      } else if (opts.stayInAiNode) {
        this.handoff("erreur_ia", undefined, text);
      }
      return;
    }

    const local = localTime(now, client.timezone);
    if (this.contact.aiUsage.day !== local.date) {
      this.contact.aiUsage = { day: local.date, calls: 0 };
    }
    if (this.contact.aiUsage.calls >= channel.aiDailyLimitPerContact) {
      this.handoff("limite_ia", undefined, text);
      return;
    }
    this.contact.aiUsage.calls += 1;

    let result;
    try {
      result = await ai({
        message: text,
        client: {
          nomResto: client.nomResto,
          timezone: client.timezone,
          maintenantLocal: `${local.date} ${local.hhmm}`,
          lienCommande: this.orderUrl() ?? "",
        },
        // L'IA ne voit jamais les tournées de livraison passées.
        infoSheet: withUpcomingRounds(infoSheet, now, client.timezone),
        flows: flows.map((f) => ({ id: f.id, name: f.name, description: f.description })),
        instructions: opts.instructions,
      });
    } catch (error) {
      this.events.push({ type: "error", message: `IA : ${errorMessage(error)}` });
      this.handoff("erreur_ia", undefined, text);
      return;
    }

    const { decision, usage } = result;
    this.events.push({ type: "ai_called", decision, usage });

    switch (decision.action) {
      case "aller_au_flux": {
        const target = decision.flux_id ? this.flow(decision.flux_id) : undefined;
        if (!target) {
          this.events.push({ type: "error", message: `IA : flux inconnu « ${decision.flux_id ?? ""} »` });
          this.handoff("ia", undefined, text);
          return;
        }
        this.startFlow(target, "ia");
        return;
      }

      case "repondre": {
        const answer = decision.texte?.trim();
        if (!answer) {
          this.handoff("ia", undefined, text);
          return;
        }
        this.send({ kind: "text", text: answer });
        if (opts.repromptNode) {
          this.sendPrompt(opts.repromptNode);
          this.refreshExpiry();
        } else if (opts.stayInAiNode) {
          this.refreshExpiry();
        }
        return;
      }

      case "transfert_humain":
        this.handoff("ia", decision.texte, text);
        return;

      default:
        this.events.push({ type: "error", message: "IA : action inconnue" });
        this.handoff("ia", undefined, text);
    }
  }

  // -------------------------------------------------------------------------
  // Exécution des blocs
  // -------------------------------------------------------------------------

  private startFlow(
    flow: Flow,
    via: "mot_cle" | "defaut" | "ia" | "aller_au_flux" | "bouton" | "evenement",
    vars: Record<string, string> = {},
  ): void {
    const trigger = findTrigger(flow);
    if (!trigger) {
      this.events.push({ type: "error", message: `Le flux « ${flow.name} » n'a pas de déclencheur` });
      this.session = null;
      return;
    }
    this.session = this.newSession(flow.id, trigger.id, vars);
    this.events.push({ type: "flow_started", flowId: flow.id, via });
    this.runFrom(this.nextNodeId(flow, trigger.id, "next"));
  }

  private followHandle(node: FlowNode, handle: string): void {
    const session = this.session!;
    session.retries = 0;
    const flow = this.flow(session.flowId)!;
    this.runFrom(this.nextNodeId(flow, node.id, handle));
  }

  /** Exécute les blocs à partir de `nodeId` jusqu'à un bloc qui attend une réponse ou la fin. */
  private runFrom(nodeId: string | undefined): void {
    let currentId = nodeId;

    while (this.session) {
      const session = this.session;
      const flow = this.flow(session.flowId);
      const node = currentId ? flow?.nodes.find((n) => n.id === currentId) : undefined;

      if (!flow || !node) {
        this.endFlow();
        return;
      }

      this.steps += 1;
      if (this.steps > MAX_STEPS_PER_MESSAGE) {
        this.events.push({ type: "error", message: "Boucle détectée : exécution interrompue" });
        this.session = null;
        return;
      }

      session.nodeId = node.id;

      switch (node.type) {
        case "trigger":
          currentId = this.nextNodeId(flow, node.id, "next");
          break;

        case "message": {
          for (const bubble of node.data.bubbles) this.sendBubble(node.id, bubble);
          currentId = this.nextNodeId(flow, node.id, "next");
          // Étape suivante reliée : la suite part tout de suite (les boutons restent cliquables).
          if (currentId) break;
          // Sinon : s'il y a des boutons de réponse, on attend le clic ; sinon, fin du flux.
          if (hasReplyButtons(node)) {
            this.refreshExpiry();
            return;
          }
          break;
        }

        case "delay":
          // -1 = délai intelligent, calculé d'après le message suivant (voir resolveDelays).
          this.send({ kind: "typing", ms: node.data.mode === "intelligent" ? -1 : fixedDelayMs(node.data.seconds) });
          currentId = this.nextNodeId(flow, node.id, "next");
          break;

        case "list":
        case "question":
          this.sendPrompt(node);
          this.refreshExpiry();
          return;

        case "ai":
          if (node.data.intro?.trim()) this.send({ kind: "text", text: this.render(node.data.intro) });
          this.refreshExpiry();
          return;

        case "condition": {
          const ok = evaluateConditions(node.data.rules, node.data.match ?? "toutes", {
            now: this.input.now,
            timezone: this.input.client.timezone,
            vars: this.vars(),
            infoSheet: this.input.infoSheet,
          });
          currentId = this.nextNodeId(flow, node.id, ok ? "vrai" : "faux");
          break;
        }

        case "handoff":
          this.handoff("bloc", node.data.text);
          return;

        case "goto_flow": {
          const target = this.flow(node.data.flowId);
          const trigger = target && findTrigger(target);
          if (!target || !trigger) {
            this.events.push({ type: "error", message: `Aller à un flux : flux introuvable « ${node.data.flowId} »` });
            this.session = null;
            return;
          }
          this.events.push({ type: "flow_ended", flowId: flow.id });
          this.events.push({ type: "flow_started", flowId: target.id, via: "aller_au_flux" });
          session.flowId = target.id;
          session.retries = 0;
          currentId = trigger.id;
          break;
        }

        case "end":
          if (node.data.text?.trim()) this.send({ kind: "text", text: this.render(node.data.text) });
          this.endFlow();
          return;
      }
    }
  }

  /** Envoie une bulle : texte seul, texte + boutons de réponse, ou texte + bouton lien. */
  private sendBubble(nodeId: string, bubble: MessageBubble): void {
    const flowId = this.session!.flowId;
    const text = this.render(bubble.text);
    const replies = bubble.buttons.filter((b) => b.kind === "reply");
    const link = bubble.buttons.find((b) => b.kind === "link");

    if (replies.length) {
      this.send({
        kind: "buttons",
        text,
        buttons: replies.map((b) => ({ id: encodeReplyId({ flowId, nodeId, handle: b.id }), title: this.render(b.title) })),
      });
      return;
    }
    if (link) {
      const url = link.orderLink ? this.orderUrl() : this.render(link.url ?? "");
      if (url && /^https?:\/\//.test(url)) {
        this.send({ kind: "link", text: text || TEXTS.orderLink, url, buttonLabel: this.render(link.title) || TEXTS.orderButton });
        return;
      }
      this.events.push({
        type: "error",
        message: link.orderLink ? "Lien de commande : slug du resto manquant" : `Bouton lien : URL invalide « ${url ?? ""} »`,
      });
    }
    if (text) this.send({ kind: "text", text });
  }

  private sendPrompt(node: WaitingNode): void {
    const flowId = this.session!.flowId;
    const withReplyIds = (options: ChoiceOption[]) =>
      options.map((o) => ({ ...o, id: encodeReplyId({ flowId, nodeId: node.id, handle: o.id }) }));

    switch (node.type) {
      case "message":
        // On renvoie seulement les bulles qui portent des boutons de réponse.
        for (const bubble of node.data.bubbles) {
          if (bubble.buttons.some((b) => b.kind === "reply")) this.sendBubble(node.id, bubble);
        }
        return;
      case "list":
        this.send({
          kind: "list",
          text: this.render(node.data.text),
          buttonLabel: node.data.buttonLabel,
          items: withReplyIds(node.data.items),
        });
        return;
      case "question":
        this.send({ kind: "text", text: this.render(node.data.text) });
        return;
      case "ai":
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Utilitaires
  // -------------------------------------------------------------------------

  private handoff(source: "bloc" | "ia" | "limite_ia" | "erreur_ia", text?: string, lastMessage?: string): void {
    this.send({ kind: "text", text: this.render(text?.trim() || TEXTS.handoff) });
    this.session = null;
    this.events.push({ type: "handoff", source, message: lastMessage });
    this.pause("transfert_humain", this.input.channel.handoffPauseHours);
  }

  private pause(reason: PauseReason, hours: number): void {
    const now = this.input.now.getTime();
    const current = this.contact.pause;
    let until: string | null = new Date(now + hours * 3_600_000).toISOString();
    // On ne raccourcit jamais une pause déjà en cours.
    if (current && (current.until === null || Date.parse(current.until) > Date.parse(until))) {
      until = current.until;
    }
    this.contact.pause = { reason, until };
    this.events.push({ type: "paused", reason, until });
  }

  private endFlow(): void {
    if (this.session) this.events.push({ type: "flow_ended", flowId: this.session.flowId });
    this.session = null;
  }

  private currentWaitingNode(): WaitingNode | undefined {
    if (!this.session) return undefined;
    const node = this.flow(this.session.flowId)?.nodes.find((n) => n.id === this.session!.nodeId);
    if (!node) return undefined;
    return node.type === "list" || node.type === "question" || node.type === "ai" || hasReplyButtons(node)
      ? (node as WaitingNode)
      : undefined;
  }

  private newSession(flowId: string, nodeId: string, vars: Record<string, string> = {}): Session {
    const now = this.input.now;
    return {
      flowId,
      nodeId,
      vars: { ...vars },
      retries: 0,
      startedAt: now.toISOString(),
      expiresAt: this.expiryFrom(now),
    };
  }

  private refreshExpiry(): void {
    if (this.session) this.session.expiresAt = this.expiryFrom(this.input.now);
  }

  private expiryFrom(now: Date): string {
    return new Date(now.getTime() + this.input.channel.sessionTimeoutMinutes * 60_000).toISOString();
  }

  private flow(id: string): Flow | undefined {
    return this.input.flows.find((f) => f.id === id);
  }

  private nextNodeId(flow: Flow, nodeId: string, handle: string): string | undefined {
    return flow.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "next") === handle)?.target;
  }

  private orderUrl(): string | undefined {
    const { orderSlug, orderBaseUrl } = this.input.client;
    if (!orderSlug) return undefined;
    return `${orderBaseUrl ?? DEFAULT_ORDER_BASE_URL}${encodeURIComponent(orderSlug)}`;
  }

  private vars(): Record<string, string> {
    const { infoSheet, now, client } = this.input;
    return {
      ...infoSheetVariables(infoSheet, now, client.timezone),
      prenom: firstName(this.contact.profileName),
      nom_resto: this.input.client.nomResto,
      lien_commande: this.orderUrl() ?? "",
      ...(this.session?.vars ?? {}),
    };
  }

  private render(text: string): string {
    return renderTemplate(text, this.vars());
  }

  private send(message: OutgoingMessage): void {
    this.outgoing.push(message);
  }
}

/**
 * Calcule les délais intelligents d'après la longueur du message qui suit,
 * et retire les délais qui ne précèdent aucun message.
 */
export function resolveDelays(outgoing: OutgoingMessage[]): OutgoingMessage[] {
  const result: OutgoingMessage[] = [];
  outgoing.forEach((message, i) => {
    if (message.kind !== "typing") {
      result.push(message);
      return;
    }
    const next = outgoing.slice(i + 1).find((m) => m.kind !== "typing");
    if (!next) return;
    result.push({ kind: "typing", ms: message.ms < 0 ? smartDelayMs(textOf(next)) : message.ms });
  });
  return result;
}

/** Retrouve l'option choisie à partir d'un texte tapé : titre exact (normalisé) ou numéro (« 1 », « 2 »…). */
export function matchOption(options: ChoiceOption[], text: string): ChoiceOption | undefined {
  const n = normalize(text);
  if (!n) return undefined;
  const byTitle = options.find((o) => normalize(o.title) === n);
  if (byTitle) return byTitle;
  if (/^\d+$/.test(n)) return options[Number(n) - 1];
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
