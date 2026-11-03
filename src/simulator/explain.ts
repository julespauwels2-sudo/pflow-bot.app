/** Journal du simulateur : pourquoi le bot a réagi (ou non), en clair. */
import { ORDER_EVENTS, type EngineEvent, type EngineInput, type EngineResult, type Flow, type FlowNode } from "@/engine";
import { BLOCKS } from "@/editor/catalog";
import { formatShort } from "./clock";

export interface JournalLine {
  tone: "ok" | "skip" | "warn" | "info";
  text: string;
}

/** Coupe à `n` caractères (emojis compris, jamais au milieu). */
const truncate = (s: string, n = 40) => {
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : s;
};

/** « Message « 👋 Hello… » », « Question », « Condition »… */
export function nodeLabel(node: FlowNode | undefined): string {
  if (!node) return "bloc inconnu";
  const label = BLOCKS[node.type]?.label ?? node.type;
  if (node.type === "message") {
    const text = node.data.bubbles[0]?.text.trim();
    return text ? `${label} « ${truncate(text.replace(/\s+/g, " "))} »` : label;
  }
  if (node.type === "question") return `${label} « ${truncate(node.data.text)} »`;
  return label;
}

export function describeIncoming(message: EngineInput["message"]): string {
  switch (message.kind) {
    case "text":
      return `Le client écrit « ${message.text} »`;
    case "button_reply":
      return `Le client clique sur « ${message.title} »`;
    case "list_reply":
      return `Le client choisit « ${message.title} » dans la liste`;
    case "echo":
      return `Le gérant répond depuis l'appli${message.text ? ` : « ${message.text} »` : ""}`;
    case "unsupported":
      return `Le client envoie un ${message.mediaType === "audio" ? "message vocal" : message.mediaType}`;
    case "event":
      return `Événement PFlow Order : ${ORDER_EVENTS[message.event].icon} ${ORDER_EVENTS[message.event].label}`;
    case "start_flow":
      return "Démarrage manuel d'un flux";
  }
}

const VIA: Record<string, string> = {
  mot_cle: "mot-clé reconnu",
  defaut: "aucun mot-clé : flux par défaut",
  ia: "choisi par l'IA",
  aller_au_flux: "« Aller à un flux »",
  bouton: "clic sur un bouton d'un message précédent",
  evenement: "événement PFlow Order",
  manuel: "démarrage manuel (simulateur)",
};

export function explainTurn(input: EngineInput, result: EngineResult): JournalLine[] {
  const flows = new Map<string, Flow>(input.flows.map((f) => [f.id, f]));
  const flowName = (id: string) => flows.get(id)?.name ?? id;
  const tz = input.client.timezone;
  const lines: JournalLine[] = [];
  const steps: { flowId: string; nodeId: string }[] = [];

  const flushSteps = () => {
    if (!steps.length) return;
    const byFlow = steps[0].flowId;
    const labels = steps.map((s) => nodeLabel(flows.get(s.flowId)?.nodes.find((n) => n.id === s.nodeId)));
    lines.push({ tone: "info", text: `Blocs exécutés (${flowName(byFlow)}) : ${labels.join(" → ")}` });
    steps.length = 0;
  };

  for (const e of result.events as EngineEvent[]) {
    if (e.type === "step") {
      if (steps.length && steps[0].flowId !== e.flowId) flushSteps();
      steps.push(e);
      continue;
    }
    flushSteps();
    switch (e.type) {
      case "keyword_matched":
        lines.push({ tone: "ok", text: `Mot-clé « ${e.keyword} » reconnu → flux « ${flowName(e.flowId)} »` });
        break;
      case "flow_started":
        if (e.via !== "mot_cle") lines.push({ tone: "ok", text: `Flux « ${flowName(e.flowId)} » lancé (${VIA[e.via] ?? e.via})` });
        break;
      case "flow_ended":
        lines.push({ tone: "info", text: `Fin du flux « ${flowName(e.flowId)} »` });
        break;
      case "ignored": {
        const reasons: Record<typeof e.reason, string> = {
          pause: `Ignoré : le bot est en pause pour ce contact${input.contact.pause?.until ? ` jusqu'à ${formatShort(new Date(input.contact.pause.until), tz, input.now)}` : ""}`,
          aucun_declencheur:
            input.channel.triggerMode === "mots_cles_uniquement"
              ? "Ignoré : aucun mot-clé reconnu, et le canal est en mode « mots-clés uniquement »"
              : "Ignoré : aucun mot-clé reconnu",
          media_non_gere: "Ignoré : type de message non géré hors conversation",
          echo: "Message du gérant",
          fenetre_fermee: `Événement ignoré : fenêtre de 24 h fermée (${input.contact.lastInboundAt ? `dernier message du client : ${formatShort(new Date(input.contact.lastInboundAt), tz, input.now)}` : "le client n'a jamais écrit au bot"})`,
          aucun_flux_evenement: "Événement ignoré : aucun flux actif pour cet événement (option non activée ?)",
        };
        lines.push({ tone: "skip", text: reasons[e.reason] });
        break;
      }
      case "pause_expired":
        lines.push({ tone: "info", text: "La pause du bot pour ce contact est terminée" });
        break;
      case "session_expired":
        lines.push({ tone: "info", text: `Conversation expirée (inactive depuis plus de ${input.channel.sessionTimeoutMinutes} min) dans « ${flowName(e.flowId)} »` });
        break;
      case "paused": {
        const why = { echo_gerant: "le gérant a répondu", transfert_humain: "transfert humain", manuel: "pause manuelle" }[e.reason];
        lines.push({ tone: "warn", text: `Bot en pause pour ce contact (${why})${e.until ? ` jusqu'à ${formatShort(new Date(e.until), tz, input.now)}` : ""}` });
        break;
      }
      case "handoff": {
        const why = { bloc: "bloc Transfert humain", ia: "décision de l'IA", limite_ia: "limite d'appels IA atteinte", erreur_ia: "erreur de l'IA" }[e.source];
        lines.push({ tone: "warn", text: `Transfert humain (${why}) : le gérant serait prévenu` });
        break;
      }
      case "ai_called":
        lines.push({ tone: "ok", text: `IA appelée : ${e.decision.action} (${e.usage.inputTokens} + ${e.usage.outputTokens} tokens)` });
        break;
      case "ai_unavailable":
        lines.push({ tone: "skip", text: "IA de secours non disponible dans le simulateur (branchée à l'étape A6)" });
        break;
      case "error":
        lines.push({ tone: "warn", text: `Erreur : ${e.message}` });
        break;
    }
  }
  flushSteps();

  if (result.session) {
    const waiting = flows.get(result.session.flowId)?.nodes.find((n) => n.id === result.session!.nodeId);
    lines.push({
      tone: "info",
      text: `En attente d'une réponse : ${nodeLabel(waiting)} (${flowName(result.session.flowId)}), expire à ${formatShort(new Date(result.session.expiresAt), tz, input.now)}`,
    });
  }
  if (lines.length === 0 && result.outgoing.length === 0) lines.push({ tone: "skip", text: "Aucune réaction du bot" });
  return lines;
}
