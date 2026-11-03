/**
 * Vérification d'un flux avant publication. Les erreurs bloquent « Publier » ;
 * les avertissements sont affichés mais n'empêchent pas de publier.
 */
import type { FlowNode, TriggerMode } from "@/engine";
import { DELAY_MAX_SECONDS, ORDER_EVENTS, parseHhmm } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { BLOCKS, MAX_BUBBLES, nodeOutputs } from "./catalog";
import { handleOf, reachableFrom } from "./graph";
import { PLATFORM_LIMITS, type Platform, type PlatformLimits } from "./limits";
import { VARIABLE_NAME, flowVariables, usedVariables } from "./variables";

export interface Issue {
  level: "error" | "warning";
  message: string;
  /** Bloc concerné (absent = problème du flux entier). */
  nodeId?: string;
}

export interface LintContext {
  /** Id du flux vérifié (pour repérer un « Aller à un flux » vers lui-même). */
  flowId: string;
  /** Flux du client : « Aller à un flux », unicité du flux par défaut et des événements. */
  flows: { id: string; name: string; isDefault?: boolean; event?: string }[];
  orderSlug: string;
  /** Mode de déclenchement du canal du client. */
  triggerMode: TriggerMode;
  /** Plateformes des canaux du client (WhatsApp seulement en phase 1). */
  platforms?: Platform[];
}

/** Limite la plus stricte parmi les plateformes du client. */
function strictest(platforms: Platform[], key: keyof Omit<PlatformLimits, "name" | "supportsList">) {
  return platforms
    .map((p) => ({ value: PLATFORM_LIMITS[p][key], name: PLATFORM_LIMITS[p].name }))
    .reduce((a, b) => (b.value < a.value ? b : a));
}

function texts(node: FlowNode): (string | undefined)[] {
  switch (node.type) {
    case "message":
      return node.data.bubbles.flatMap((b) => [b.text, ...b.buttons.map((x) => x.title), ...b.buttons.map((x) => (x.kind === "link" ? x.url : undefined))]);
    case "list":
      return [node.data.text];
    case "question":
      return [node.data.text, node.data.errorText];
    case "ai":
      return [node.data.intro];
    case "handoff":
    case "end":
      return [node.data.text];
    default:
      return [];
  }
}

export function lintFlow(graph: FlowGraph, ctx: LintContext): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string, nodeId?: string) => issues.push({ level: "error", message, nodeId });
  const warning = (message: string, nodeId?: string) => issues.push({ level: "warning", message, nodeId });
  const len = (s: string | undefined) => [...(s ?? "")].length;
  const platforms: Platform[] = ctx.platforms?.length ? ctx.platforms : ["whatsapp"];
  const limit = (key: Parameters<typeof strictest>[1]) => strictest(platforms, key);

  /** Bloc Message : chaque bulle est un message WhatsApp, avec ses propres règles. */
  const checkMessage = (id: string, node: Extract<FlowNode, { type: "message" }>, connected: Set<string>) => {
    const bubbles = node.data.bubbles;
    if (bubbles.length === 0) error("Ajoutez au moins une bulle.", id);
    if (bubbles.length > MAX_BUBBLES) error(`${MAX_BUBBLES} bulles au maximum par bloc.`, id);
    const titles = new Set<string>();
    bubbles.forEach((bubble, i) => {
      const at = bubbles.length > 1 ? `Bulle ${i + 1} : ` : "";
      const replies = bubble.buttons.filter((b) => b.kind === "reply");
      const links = bubble.buttons.filter((b) => b.kind === "link");
      const interactive = bubble.buttons.length > 0;

      if (replies.length && links.length) error(`${at}une bulle ne peut pas mélanger boutons de réponse et bouton lien (règle WhatsApp).`, id);
      if (links.length > 1) error(`${at}un seul bouton lien par bulle (règle WhatsApp).`, id);

      const body = limit(interactive ? "interactiveBody" : "textBody");
      if (!bubble.text.trim()) error(interactive ? `${at}le texte au-dessus des boutons est obligatoire.` : `${at}bulle vide.`, id);
      if (len(bubble.text) > body.value) error(`${at}texte trop long (${len(bubble.text)} / ${body.value}).`, id);

      const max = limit("replyButtonsMax");
      if (replies.length > max.value) error(`${at}${max.name} limite à ${max.value} boutons de réponse par bulle.`, id);
      const titleMax = limit("replyButtonTitle");
      for (const b of replies) {
        const title = b.title.trim();
        if (!title) error(`${at}un bouton n'a pas de titre.`, id);
        else if (len(title) > titleMax.value) error(`Bouton « ${title} » trop long (${len(title)} / ${titleMax.value}).`, id);
        if (title && titles.has(title.toLowerCase())) error(`Deux boutons s'appellent « ${title} ».`, id);
        titles.add(title.toLowerCase());
        if (!connected.has(b.id)) error(`Bouton « ${title || "sans titre"} » non relié.`, id);
      }

      const ctaMax = limit("ctaButtonLabel");
      for (const b of links) {
        const title = b.title.trim();
        if (!title) error(`${at}le bouton lien n'a pas de titre.`, id);
        else if (len(title) > ctaMax.value) error(`Bouton lien « ${title} » trop long (${len(title)} / ${ctaMax.value}).`, id);
        if (b.orderLink) {
          if (!ctx.orderSlug) error("Ce client n'a pas de slug : le lien de commande est impossible.", id);
        } else {
          const url = (b.url ?? "").trim();
          if (!url) error(`${at}l'URL du bouton lien est vide.`, id);
          else if (!/^https:\/\//.test(url) && !url.startsWith("{{")) error(`${at}l'URL doit commencer par https://`, id);
        }
      }
    });
  };

  // Déclencheur
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) error("Le flux n'a pas de déclencheur.");
  if (triggers.length > 1) for (const t of triggers.slice(1)) error("Un flux ne peut avoir qu'un seul déclencheur.", t.id);

  // Blocs non reliés
  const trigger = triggers[0];
  if (trigger) {
    const reachable = reachableFrom(graph, trigger.id);
    for (const node of graph.nodes) {
      if (node.type !== "trigger" && !reachable.has(node.id)) error("Bloc non relié au déclencheur.", node.id);
    }
  }

  // Variables connues
  const known = new Set(flowVariables(graph.nodes).map((v) => v.name));

  for (const node of graph.nodes) {
    const id = node.id;
    const connected = new Set(graph.edges.filter((e) => e.source === id).map(handleOf));
    const outputs = nodeOutputs(node);

    for (const text of texts(node)) {
      for (const v of usedVariables(text)) {
        if (!known.has(v)) warning(`Variable {{${v}}} jamais définie : elle sera vide.`, id);
      }
    }

    switch (node.type) {
      case "trigger":
        if (node.data.event) {
          const other = ctx.flows.find((f) => f.event === node.data.event && f.id !== ctx.flowId);
          if (other) error(`Le flux « ${other.name} » réagit déjà à l'événement « ${ORDER_EVENTS[node.data.event].label} ».`, id);
          if (!connected.has("next")) error("Le déclencheur n'est relié à rien.", id);
          break;
        }
        if (node.data.isDefault) {
          if (ctx.triggerMode === "mots_cles_uniquement") {
            error(
              "Flux par défaut interdit : ce client est en mode « mots-clés uniquement » (numéro en coexistence). Le bot répondrait à des conversations privées.",
              id,
            );
          }
          const other = ctx.flows.find((f) => f.isDefault && !f.event && f.id !== ctx.flowId);
          if (other) error(`Le flux « ${other.name} » est déjà le flux par défaut : un seul par client.`, id);
        }
        // Pas de mot-clé : normal pour un sous-flux (lancé par « Aller à un flux » ou par l'IA).
        if (!connected.has("next")) error("Le déclencheur n'est relié à rien.", id);
        break;

      case "message":
        checkMessage(id, node, connected);
        break;

      case "delay":
        if (node.data.mode === "fixe") {
          const sec = node.data.seconds ?? 2;
          if (sec < 0.5 || sec > DELAY_MAX_SECONDS) error(`Délai entre 0,5 et ${DELAY_MAX_SECONDS} secondes.`, id);
        }
        if (!connected.has("next")) warning("Rien après le délai : il ne sert à rien.", id);
        break;

      case "list": {
        const unsupported = platforms.filter((p) => !PLATFORM_LIMITS[p].supportsList);
        if (unsupported.length) {
          error(`Les listes n'existent pas sur ${unsupported.map((p) => PLATFORM_LIMITS[p].name).join(", ")} : utilisez des boutons.`, id);
          break;
        }
        const body = limit("interactiveBody");
        if (!node.data.text.trim()) error("Le texte de la liste est obligatoire.", id);
        if (len(node.data.text) > body.value) error(`Texte trop long (${len(node.data.text)} / ${body.value}).`, id);
        const labelMax = limit("listButtonLabel");
        const label = node.data.buttonLabel.trim();
        if (!label) error("Le libellé du bouton de la liste est obligatoire.", id);
        else if (len(label) > labelMax.value) error(`Libellé « ${label} » trop long (${len(label)} / ${labelMax.value}).`, id);
        const rows = limit("listRowsMax");
        if (node.data.items.length === 0) error("Ajoutez au moins un choix.", id);
        if (node.data.items.length > rows.value) error(`${rows.name} limite à ${rows.value} choix.`, id);
        const titleMax = limit("listRowTitle");
        const descMax = limit("listRowDescription");
        const titles = new Set<string>();
        for (const item of node.data.items) {
          const title = item.title.trim();
          if (!title) error("Un choix n'a pas de titre.", id);
          else if (len(title) > titleMax.value) error(`Choix « ${title} » trop long (${len(title)} / ${titleMax.value}).`, id);
          if (len(item.description) > descMax.value) {
            error(`Description de « ${title} » trop longue (${len(item.description)} / ${descMax.value}).`, id);
          }
          if (title && titles.has(title.toLowerCase())) error(`Deux choix s'appellent « ${title} ».`, id);
          titles.add(title.toLowerCase());
        }
        for (const o of outputs) if (!connected.has(o.id)) error(`Choix « ${o.label || "sans titre"} » non relié.`, id);
        break;
      }

      case "question":
        if (!node.data.text.trim()) error("La question est vide.", id);
        if (!VARIABLE_NAME.test(node.data.variable)) {
          error("Nom de variable invalide (minuscules, chiffres et _ ; ex. nb_personnes).", id);
        }
        if (!connected.has("next")) warning("Rien ne se passe après la réponse : la conversation s'arrête.", id);
        break;

      case "condition": {
        if (node.data.rules.length === 0) warning("Aucune règle : la condition est toujours vraie.", id);
        for (const rule of node.data.rules) {
          if (rule.kind === "jour" && rule.jours.length === 0) error("Choisissez au moins un jour.", id);
          if (rule.kind === "heure" && (parseHhmm(rule.de) === null || parseHhmm(rule.a) === null)) error("Heure invalide.", id);
          if (rule.kind === "heure" && rule.de === rule.a) error("La plage horaire est vide (début = fin).", id);
          if (rule.kind === "variable" && !rule.variable.trim()) error("Choisissez la variable à tester.", id);
          if (rule.kind === "variable" && rule.variable.trim() && !known.has(rule.variable)) {
            warning(`Variable « ${rule.variable} » jamais définie dans ce flux.`, id);
          }
        }
        if (!connected.has("vrai")) warning("Sortie « Vrai » non reliée : la conversation s'arrête.", id);
        if (!connected.has("faux")) warning("Sortie « Faux » non reliée : la conversation s'arrête.", id);
        break;
      }

      case "goto_flow":
        if (!node.data.flowId) error("Choisissez le flux de destination.", id);
        else if (node.data.flowId === ctx.flowId) warning("Ce bloc renvoie vers le flux lui-même (risque de boucle).", id);
        else if (!ctx.flows.some((f) => f.id === node.data.flowId)) error("Le flux de destination n'existe plus.", id);
        break;

      case "ai":
      case "handoff":
      case "end":
        break;
    }
  }

  return issues;
}

export function issuesByNode(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
  }
  return map;
}

export const blockLabel = (node: FlowNode) => BLOCKS[node.type].label;
