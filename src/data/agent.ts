/**
 * Agent IA du modèle maître : consigne par défaut (tirée de la consigne UChat de Jules, rendue
 * générique), fonctions par défaut, vérification, et conversion vers la config du moteur.
 */
import { DEFAULT_CHANNEL_SETTINGS, type AgentConfig, type AiTextMode, type Flow } from "@/engine";
import type { BotTemplate, StoredFlow, TemplateAgent, TemplateAgentFunction } from "./types";

/** Délai d'inactivité des blocs IA par défaut (comme « continuer après 10 minutes » dans UChat). */
export const DEFAULT_AI_INACTIVITY_MINUTES = 10;

export const AI_TEXT_MODES: Record<AiTextMode, { label: string; hint: string }> = {
  silence: { label: "L'IA se tait, le flux répond seul", hint: "Pour lancer_commande, parler_equipe : aucun texte de l'IA." },
  variable: {
    label: "Réponse de l'IA passée au flux ({{ia_reponse}})",
    hint: "Pour proposer_commande : le flux affiche la réponse de l'IA où il veut.",
  },
  avant: { label: "L'IA répond, puis le flux", hint: "Le texte de l'IA part d'abord, puis le flux." },
};

export const FUNCTION_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Fonctions de la trame PFlow, reliées aux flux du dossier « Fonctions IA » par leur nom. */
export const DEFAULT_FUNCTIONS: (Omit<TemplateAgentFunction, "flowId"> & { flowName: string })[] = [
  {
    name: "lancer_commande",
    flowName: "IA - Lancer commande",
    aiText: "silence",
    description:
      "Le client veut commander maintenant (« je veux commander », « j'ai faim », « je voudrais manger », « je veux voir la carte », « qu'est-ce que vous avez ? »). Envoie le bouton « Je commande ». Ne génère aucun texte.",
  },
  {
    name: "proposer_commande",
    flowName: "IA - Proposer commande",
    aiText: "variable",
    description:
      "Tu recommandes un ou plusieurs produits, le client montre de l'intérêt pour un produit (« ça a l'air bon », « c'est combien ? », « vous avez quoi au chocolat ? »), ou tu viens de répondre à une question (horaires, livraison, paiement, produits, carte, prix) et commander est une suite naturelle. Mets ta réponse complète dans « texte » : le flux l'affiche, puis le bouton « Je commande ». Pas pour une intention directe de commande (lancer_commande), ni pour une allergie, un problème ou une réclamation.",
  },
  {
    name: "parler_equipe",
    flowName: "IA - Parler équipe",
    aiText: "silence",
    description:
      "Le client demande une personne, ou la situation demande l'équipe : réclamation, problème avec une commande reçue (erreur, produit manquant, qualité), allergie grave, information introuvable. Le bot se met en pause et l'équipe reprend. Ne génère aucun texte.",
  },
  {
    name: "suivre_commande",
    flowName: "IA - Suivre commande",
    aiText: "silence",
    description:
      "Le client demande où en est sa commande (« elle arrive quand ? », « c'est prêt ? », « vous avez bien reçu ma commande ? »). PFlow Order répond avec l'état réel de sa dernière commande. Ne génère aucun texte.",
  },
  {
    name: "annuler_commande",
    flowName: "IA - Annuler commande",
    aiText: "silence",
    description:
      "Le client veut annuler sa commande. Le flux lui demande de confirmer, puis PFlow Order annule (remboursée si payée) ou explique pourquoi c'est impossible. Ne génère aucun texte et ne confirme jamais une annulation toi-même.",
  },
];

/**
 * Textes par défaut des versions précédentes (empreinte FNV-1a et longueur) : un modèle qui les a gardés
 * tels quels est mis à niveau automatiquement (« Compléter le modèle »). Un texte modifié par Jules
 * n'est jamais remplacé.
 */
export const PREVIOUS_DEFAULTS = {
  consigne: ["d48c88eb:4709"],
  functions: { proposer_commande: ["de13b120:332"], parler_equipe: ["bc01880c:251"] } as Record<string, string[]>,
};

/** Empreinte courte d'un texte (FNV-1a 32 bits + longueur), identique côté serveur et navigateur. */
export function textFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}:${text.length}`;
}

/** Consigne générale par défaut : persona et règles de Jules, sans rien de propre à un client. */
export const DEFAULT_CONSIGNE = `Tu es l'assistant WhatsApp officiel de {{nom_resto}}.

Tu échanges comme un excellent membre de l'équipe du restaurant : chaleureux, naturel, rapide, serviable et professionnel. Tu ne dois jamais donner l'impression d'être un robot ou un service client générique.

Ton objectif :
• répondre clairement aux questions du client ;
• faciliter sa prise de décision ;
• l'aider à commander lorsque c'est pertinent ;
• rendre chaque échange simple et agréable.

Tu utilises le prénom du client quand il est connu et que c'est naturel, sans le répéter à chaque réponse.

# Commandes
- Le client commande sur la page de commande PFlow Order (bouton « Je commande »). Ne prends jamais la commande dans la conversation.
- Intention claire de commander (« je veux commander », « j'ai faim », « je voudrais manger », « je veux voir la carte », « qu'est-ce que vous avez ? ») : utilise lancer_commande, jamais proposer_commande.
- Quand tu recommandes un ou plusieurs produits, ou que le client montre de l'intérêt pour un produit (« ça a l'air bon », « c'est combien le … ? », « vous avez quoi au chocolat ? ») : utilise proposer_commande avec ta réponse complète dans « texte ». Le client reçoit ta réponse, puis le bouton « Je commande ».
- Après une réponse sur les horaires, la livraison, le retrait, le paiement, les produits, la carte ou les prix : utilise proposer_commande si commander est une suite naturelle. Pas à chaque réponse.
- Pour une allergie, un problème, une réclamation, une annulation ou une demande sensible : aide d'abord le client, sans proposer de commander.
- Ne force jamais commercialement une commande quand le contexte ne s'y prête pas.
- On peut commander à toute heure, même quand le restaurant est fermé : la page de commande propose alors les créneaux du prochain jour d'ouverture. Ne dis jamais qu'il est impossible de commander parce que c'est fermé.
- La page de commande fait foi pour la disponibilité des produits et les délais : ne garantis jamais qu'un produit est disponible et n'annonce jamais de délai précis.

# Après commande
- Le client demande où en est sa commande (« elle arrive quand ? », « c'est prêt ? ») : utilise suivre_commande, sans texte. PFlow Order répond avec l'état réel.
- Le client veut annuler sa commande : utilise annuler_commande, sans texte. Le flux lui demande de confirmer. Ne confirme jamais une annulation toi-même.
- Problème avec une commande reçue (erreur, produit manquant, qualité) : utilise parler_equipe.
- Si le client demande une personne, ou si la situation demande l'équipe : utilise parler_equipe.

# Appels de fonctions (règle prioritaire)
Quand une fonction lance un flux qui répond lui-même (lancer_commande, parler_equipe, suivre_commande, annuler_commande), n'écris AUCUN texte. N'annonce jamais « je regarde », « je vérifie », « un instant » ou « je m'en occupe ».

# Produits et carte (règle prioritaire)
- La carte et la base de connaissances sont les seules sources de vérité. N'invente jamais un produit, une recette, un parfum, un accompagnement, une boisson, un prix ou une disponibilité.
- Un produit cité par le client n'est jamais une preuve qu'il existe. S'il n'apparaît pas dans la carte : « Je ne vois pas ce produit dans notre carte actuelle. », puis propose seulement des alternatives qui y figurent.
- Ne transforme jamais une supposition ou une phrase précédente de la conversation en information officielle.

# Allergènes
- Réponds uniquement à partir des informations de la carte. « Non renseignés » ne veut jamais dire « sans allergène ».
- Question sans produit précis : demande seulement « ⚠️ *Bien sûr !* Pour quel plat ou produit souhaitez-vous connaître les allergènes ? », sans liste générale.
- Produit identifié : commence par « ⚠️ *Allergènes — [nom du produit]* », saute une ligne, puis un allergène par ligne avec une puce (• *Gluten* — présent).
- Plusieurs produits : produit par produit. Allergie précise (arachides, lait, gluten, œufs…) : dis clairement si l'allergène est présent.
- Information indisponible, doute ou allergie sévère : invite le client à confirmer avec l'équipe avant de commander.

# Style WhatsApp
- Réponses courtes et aérées, faciles à lire sur un téléphone. Pas de gros paragraphes.
- Retours à la ligne entre les informations ; puces simples « • » quand il y en a plusieurs.
- *Gras* (un astérisque) seulement pour l'essentiel : horaires, prix, zone, nom d'un produit, statut.
- 0 à 2 émojis par réponse, pour la compréhension ou la chaleur, pas pour décorer.
- Réponds d'abord directement à la question, puis termine par une seule question ou proposition utile si c'est pertinent.
- Ne salue jamais à nouveau (« Bonjour », « Hello »…) : l'accueil l'a déjà fait. Ne répète pas les mêmes informations, évite « Avec plaisir » ou « Comment puis-je vous aider ? » quand ce n'est pas naturel, et ne termine pas chaque réponse par « Avez-vous d'autres questions ? ».
- N'écris jamais de lien : pour orienter vers la commande, utilise proposer_commande ou lancer_commande, qui envoient le bouton.
- Évite le jargon et les formules artificielles (« Je serais ravi de vous assister dans votre demande »).
- En cas de doute sur l'intention du client, pose au maximum une question courte.

Exemple de bonne réponse :
🕒 *Nos horaires*

Nous sommes ouverts *du mardi au vendredi, de 8h à 12h*.

Une petite faim ? 😋`;

/**
 * Met un agent existant à niveau (« Compléter le modèle ») : ajoute les fonctions par défaut qui manquent
 * (reliées aux flux du même nom), et remplace la consigne et les descriptions restées identiques à une
 * version précédente par défaut. Ce que Jules a modifié n'est jamais touché. Renvoie null si rien ne change.
 */
export function upgradeAgent(agent: TemplateAgent, templateFlows: Pick<StoredFlow, "id" | "name">[]): { agent: TemplateAgent; changes: string[] } | null {
  const changes: string[] = [];
  const idByName = new Map(templateFlows.map((f) => [f.name.trim().toLowerCase(), f.id]));
  let consigne = agent.consigne;
  if (consigne && PREVIOUS_DEFAULTS.consigne.includes(textFingerprint(consigne))) {
    consigne = DEFAULT_CONSIGNE;
    changes.push("consigne par défaut mise à jour");
  }
  const functions = (agent.functions ?? []).map((f) => {
    const def = DEFAULT_FUNCTIONS.find((d) => d.name === f.name);
    if (def && PREVIOUS_DEFAULTS.functions[f.name]?.includes(textFingerprint(f.description))) {
      changes.push(`description de ${f.name} mise à jour`);
      return { ...f, description: def.description };
    }
    return f;
  });
  for (const { flowName, ...def } of DEFAULT_FUNCTIONS) {
    if (functions.some((f) => f.name === def.name)) continue;
    const flowId = idByName.get(flowName.toLowerCase());
    if (!flowId) continue;
    functions.push({ ...def, flowId });
    changes.push(`fonction ${def.name} ajoutée`);
  }
  return changes.length ? { agent: { ...agent, consigne, functions }, changes } : null;
}

/** Agent proposé par défaut : fonctions reliées aux flux du modèle qui portent le bon nom. */
export function defaultAgent(templateFlows: Pick<StoredFlow, "id" | "name">[]): TemplateAgent {
  const idByName = new Map(templateFlows.map((f) => [f.name.trim().toLowerCase(), f.id]));
  return {
    consigne: DEFAULT_CONSIGNE,
    dailyLimit: DEFAULT_CHANNEL_SETTINGS.aiDailyLimitPerContact,
    inactivityMinutes: DEFAULT_AI_INACTIVITY_MINUTES,
    functions: DEFAULT_FUNCTIONS.flatMap(({ flowName, ...f }) => {
      const flowId = idByName.get(flowName.toLowerCase());
      return flowId ? [{ ...f, flowId }] : [];
    }),
  };
}

export interface AgentIssue {
  level: "error" | "warning";
  message: string;
}

/** Vérifie l'agent avant enregistrement (les erreurs bloquent). */
export function checkAgent(agent: TemplateAgent, templateFlows: Pick<StoredFlow, "id" | "name" | "published">[]): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const names = new Set<string>();
  for (const f of agent.functions ?? []) {
    const label = f.name || "(sans nom)";
    if (!FUNCTION_NAME_PATTERN.test(f.name)) {
      issues.push({ level: "error", message: `Fonction « ${label} » : nom en minuscules, chiffres et _ uniquement (ex. lancer_commande).` });
    }
    if (names.has(f.name)) issues.push({ level: "error", message: `Deux fonctions s'appellent « ${f.name} ».` });
    names.add(f.name);
    const flow = templateFlows.find((t) => t.id === f.flowId);
    if (!flow) issues.push({ level: "error", message: `Fonction « ${label} » : choisissez le flux à lancer.` });
    else if (!flow.published) issues.push({ level: "warning", message: `Fonction « ${label} » : le flux « ${flow.name} » n'est pas publié, l'IA ne pourra pas l'appeler.` });
    if (!f.description.trim()) issues.push({ level: "error", message: `Fonction « ${label} » : la description est obligatoire (c'est elle qui dit à l'IA quand l'utiliser).` });
  }
  if (!agent.consigne?.trim()) issues.push({ level: "warning", message: "Consigne vide : l'IA n'aura que les règles PFlow et la fiche d'infos." });
  return issues;
}

/** Config du moteur pour un bot : fonctions du modèle (flux actifs du bot uniquement). */
export function agentConfigFor(template: Pick<BotTemplate, "agent"> | null | undefined, botFlows: Pick<Flow, "id">[]): AgentConfig | undefined {
  const agent = template?.agent;
  if (!agent) return undefined;
  const active = new Set(botFlows.map((f) => f.id));
  return {
    consigne: agent.consigne ?? "",
    model: agent.model,
    inactivityMinutes: agent.inactivityMinutes,
    functions: (agent.functions ?? [])
      .filter((f) => active.has(f.flowId))
      .map((f) => ({ name: f.name, flowId: f.flowId, description: f.description, aiText: f.aiText ?? "silence" })),
  };
}

/** Limite d'appels IA par contact et par jour pour ce bot. */
export function aiDailyLimit(template: Pick<BotTemplate, "agent"> | null | undefined): number {
  return template?.agent?.dailyLimit ?? DEFAULT_CHANNEL_SETTINGS.aiDailyLimitPerContact;
}
