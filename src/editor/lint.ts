/**
 * Vérification d'un flux avant publication. Les erreurs bloquent « Publier » ;
 * les avertissements sont affichés mais n'empêchent pas de publier.
 */
import type { ChoiceOption, FlowNode, TriggerMode } from "@/engine";
import { DELAY_MAX_SECONDS, parseHhmm } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { BLOCKS, nodeOutputs } from "./catalog";
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
  /** Flux du client : « Aller à un flux », et unicité du flux par défaut. */
  flows: { id: string; name: string; isDefault?: boolean }[];
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
      return [node.data.text];
    case "buttons":
    case "list":
      return [node.data.text];
    case "question":
      return [node.data.text, node.data.errorText];
    case "order_link":
      return [node.data.text];
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

  /** Boutons de réponse (bloc Message avec boutons, ou ancien bloc Boutons). */
  const checkReplyButtons = (id: string, text: string, buttons: ChoiceOption[], connected: Set<string>) => {
    const body = limit("interactiveBody");
    if (!text.trim()) error("Le texte au-dessus des boutons est obligatoire.", id);
    if (len(text) > body.value) error(`Texte trop long pour des boutons (${len(text)} / ${body.value}).`, id);
    const max = limit("replyButtonsMax");
    if (buttons.length > max.value) error(`${max.name} limite à ${max.value} boutons.`, id);
    const titleMax = limit("replyButtonTitle");
    const titles = new Set<string>();
    for (const b of buttons) {
      const title = b.title.trim();
      if (!title) error("Un bouton n'a pas de titre.", id);
      else if (len(title) > titleMax.value) error(`Bouton « ${title} » trop long (${len(title)} / ${titleMax.value}).`, id);
      if (title && titles.has(title.toLowerCase())) error(`Deux boutons s'appellent « ${title} ».`, id);
      titles.add(title.toLowerCase());
      if (!connected.has(b.id)) error(`Bouton « ${title || "sans titre"} » non relié.`, id);
    }
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
        if (node.data.isDefault) {
          if (ctx.triggerMode === "mots_cles_uniquement") {
            error(
              "Flux par défaut interdit : ce client est en mode « mots-clés uniquement » (numéro en coexistence). Le bot répondrait à des conversations privées.",
              id,
            );
          }
          const other = ctx.flows.find((f) => f.isDefault && f.id !== ctx.flowId);
          if (other) error(`Le flux « ${other.name} » est déjà le flux par défaut : un seul par client.`, id);
        } else if (!node.data.keywords.some((k) => k.trim())) {
          warning("Aucun mot-clé : ce flux ne sera lancé que par l'IA ou « Aller à un flux ».", id);
        }
        if (!connected.has("next")) error("Le déclencheur n'est relié à rien.", id);
        break;

      case "message": {
        if (node.data.buttons?.length) {
          checkReplyButtons(id, node.data.text, node.data.buttons, connected);
          break;
        }
        const max = limit("textBody");
        if (!node.data.text.trim()) error("Le message est vide.", id);
        if (len(node.data.text) > max.value) error(`Message trop long (${len(node.data.text)} / ${max.value}).`, id);
        break;
      }

      case "delay":
        if (node.data.mode === "fixe") {
          const sec = node.data.seconds ?? 2;
          if (sec < 0.5 || sec > DELAY_MAX_SECONDS) error(`Délai entre 0,5 et ${DELAY_MAX_SECONDS} secondes.`, id);
        }
        if (!connected.has("next")) warning("Rien après le délai : il ne sert à rien.", id);
        break;

      case "buttons":
        if (node.data.buttons.length === 0) error("Ajoutez au moins un bouton.", id);
        checkReplyButtons(id, node.data.text, node.data.buttons, connected);
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

      case "order_link": {
        if (!ctx.orderSlug) error("Ce client n'a pas de slug : le lien de commande est impossible.", id);
        const cta = limit("ctaButtonLabel");
        if (len(node.data.buttonLabel) > cta.value) error(`Libellé du bouton trop long (${len(node.data.buttonLabel)} / ${cta.value}).`, id);
        const body = limit("interactiveBody");
        if (len(node.data.text) > body.value) error(`Texte trop long (${len(node.data.text)} / ${body.value}).`, id);
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
