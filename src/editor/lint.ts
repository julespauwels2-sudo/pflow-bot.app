/**
 * Vérification d'un flux avant publication. Les erreurs bloquent « Publier » ;
 * les avertissements sont affichés mais n'empêchent pas de publier.
 */
import type { FlowNode } from "@/engine";
import { parseHhmm } from "@/engine";
import type { FlowGraph } from "@/data/types";
import { BLOCKS, nodeOutputs } from "./catalog";
import { handleOf, reachableFrom } from "./graph";
import { WA_LIMITS } from "./limits";
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
  /** Autres flux du client, pour « Aller à un flux ». */
  flows: { id: string; name: string }[];
  orderSlug: string;
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
        if (!node.data.keywords.some((k) => k.trim())) {
          warning("Aucun mot-clé : ce flux ne sera lancé que par l'IA ou « Aller à un flux ».", id);
        }
        if (!connected.has("next")) error("Le déclencheur n'est relié à rien.", id);
        break;

      case "message":
        if (!node.data.text.trim()) error("Le message est vide.", id);
        if (len(node.data.text) > WA_LIMITS.textBody) error(`Message trop long (${len(node.data.text)} / ${WA_LIMITS.textBody}).`, id);
        break;

      case "buttons": {
        if (!node.data.text.trim()) error("Le texte au-dessus des boutons est obligatoire.", id);
        if (len(node.data.text) > WA_LIMITS.interactiveBody) error(`Texte trop long (${len(node.data.text)} / ${WA_LIMITS.interactiveBody}).`, id);
        if (node.data.buttons.length === 0) error("Ajoutez au moins un bouton.", id);
        if (node.data.buttons.length > WA_LIMITS.buttonsMax) error(`WhatsApp limite à ${WA_LIMITS.buttonsMax} boutons.`, id);
        const titles = new Set<string>();
        for (const b of node.data.buttons) {
          const title = b.title.trim();
          if (!title) error("Un bouton n'a pas de titre.", id);
          else if (len(title) > WA_LIMITS.buttonTitle) error(`Bouton « ${title} » trop long (${len(title)} / ${WA_LIMITS.buttonTitle}).`, id);
          if (title && titles.has(title.toLowerCase())) error(`Deux boutons s'appellent « ${title} ».`, id);
          titles.add(title.toLowerCase());
        }
        for (const o of outputs) if (!connected.has(o.id)) error(`Bouton « ${o.label || "sans titre"} » non relié.`, id);
        break;
      }

      case "list": {
        if (!node.data.text.trim()) error("Le texte de la liste est obligatoire.", id);
        if (len(node.data.text) > WA_LIMITS.interactiveBody) error(`Texte trop long (${len(node.data.text)} / ${WA_LIMITS.interactiveBody}).`, id);
        const label = node.data.buttonLabel.trim();
        if (!label) error("Le libellé du bouton de la liste est obligatoire.", id);
        else if (len(label) > WA_LIMITS.listButtonLabel) error(`Libellé « ${label} » trop long (${len(label)} / ${WA_LIMITS.listButtonLabel}).`, id);
        if (node.data.items.length === 0) error("Ajoutez au moins un choix.", id);
        if (node.data.items.length > WA_LIMITS.listRowsMax) error(`WhatsApp limite à ${WA_LIMITS.listRowsMax} choix.`, id);
        const titles = new Set<string>();
        for (const item of node.data.items) {
          const title = item.title.trim();
          if (!title) error("Un choix n'a pas de titre.", id);
          else if (len(title) > WA_LIMITS.listRowTitle) error(`Choix « ${title} » trop long (${len(title)} / ${WA_LIMITS.listRowTitle}).`, id);
          if (len(item.description) > WA_LIMITS.listRowDescription) {
            error(`Description de « ${title} » trop longue (${len(item.description)} / ${WA_LIMITS.listRowDescription}).`, id);
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

      case "order_link":
        if (!ctx.orderSlug) error("Ce client n'a pas de slug : le lien de commande est impossible.", id);
        if (len(node.data.buttonLabel) > WA_LIMITS.ctaButtonLabel) {
          error(`Libellé du bouton trop long (${len(node.data.buttonLabel)} / ${WA_LIMITS.ctaButtonLabel}).`, id);
        }
        break;

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
