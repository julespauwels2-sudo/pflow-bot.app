/**
 * Bot PFlow de base du numéro PFlow : répond quand aucun mot-clé de démo personnalisée n'a été écrit. Figé
 * dans le code (jamais modifié depuis l'app). Un parcours simple et guidé, un seul chemin, les choix à la fin :
 *   Accueil [Tester la démo] → Étape 1/3 [Je commande] → (« J'ai passé ma commande ✅ ») → Étape 2/3
 *   [Voir le dashboard] → (« J'ai vu le dashboard 👀 ») → Étape 3/3 [Je veux le mien] [Comment ça marche ?].
 * La démo permanente (Mint Bun) se joue sur la vraie page de commande et le vrai Dashboard de démonstration
 * du CRM ; leurs boutons « Retour sur WhatsApp » renvoient ici le texte qui fait passer à l'étape suivante.
 * Filet de sécurité (src/demos/parcours.ts) : un autre message rappelle l'étape en cours. Sans IA : aucun coût.
 */
import { DEFAULT_TIMEZONE, encodeReplyId, type ChoiceOption, type Flow, type FlowNode } from "@/engine";
import type { LoadedBot } from "@/channels/core/bot-loader";

export const PFLOW_BOT_ID = "pflow";

const at = (x: number, y: number) => ({ x, y });
const reply = (id: string, title: string) => ({ id, kind: "reply" as const, title });
const link = (id: string, title: string, url: string) => ({ id, kind: "link" as const, title, url });
type Button = ReturnType<typeof reply> | ReturnType<typeof link>;
const message = (id: string, bubbles: { text: string; buttons?: Button[] }[], y = 0): FlowNode => ({
  id,
  type: "message",
  position: at(340, y),
  data: { bubbles: bubbles.map((b, i) => ({ id: `${id}-${i + 1}`, text: b.text, buttons: b.buttons ?? [] })) },
});
const goto = (id: string, flowId: string, y = 0): FlowNode => ({ id, type: "goto_flow", position: at(720, y), data: { flowId } });
const trigger = (keywords: string[], extra: { isDefault?: boolean } = {}): FlowNode => ({
  id: "t",
  type: "trigger",
  position: at(0, 0),
  data: { keywords, ...extra },
});

/**
 * Démo permanente (Mint Bun) : pages de démonstration du CRM, servies en mémoire (aucune commande réelle,
 * aucun paiement, aucun message). Le resto vit seulement dans le navigateur (repo/img/demo/mint-bun/ du CRM).
 * retourCommande / retourDashboard : textes préremplis des boutons « Retour sur WhatsApp » du CRM (même texte
 * des deux côtés, testé).
 */
export const DEMO_PERMANENTE = {
  nomResto: "Mint Bun",
  commandeUrl: "https://order.pflow.fr/demo/commande?r=pflow",
  dashboardUrl: "https://order.pflow.fr/demo?r=pflow",
  numeroWhatsapp: "590691266853",
  retourCommande: "J'ai passé ma commande ✅",
  retourDashboard: "J'ai vu le dashboard 👀",
};

export const PFLOW_TEXTS = {
  /** Accueil : un seul message, un seul bouton. */
  welcome: `👋 Bienvenue chez PFlow ! Testez en 1 minute ce que vos clients vivraient en commandant chez vous sur WhatsApp. On fait comme si vous étiez client de ${DEMO_PERMANENTE.nomResto}, notre resto de démo 🍔\n\n_Vous avez un code de démo ? Écrivez-le ici._`,
  step1: "*Étape 1/3* : passez commande comme un client 👇\nVotre confirmation arrivera ici, comme pour un vrai client.",
  step2: "*Étape 2/3* : voici ce que le resto voit, en direct 👇\nVotre commande vient d'y arriver.",
  /**
   * Confirmation automatique de la commande de démo (comme un vrai client PFlow Order), envoyée quand le prospect
   * valide sa commande sur la page Mint Bun (POST /api/demo/commande), juste avant l'étape 2/3.
   */
  orderConfirmed:
    "✅ *Commande enregistrée !*\nMerci 🙏 {{nom_demo}} a bien reçu votre commande.\n\n🧾 *Commande #{{commande_numero}}* — {{commande_mode}}\n{{commande_recap}}\n\n💰 *Total : {{commande_total}}*\n💳 Paiement sur place\n\n_Commande de démo : rien n'est préparé._",
  step3: "✨ *Étape 3/3* : et pour votre resto ? On adapte tout à votre carte et à votre façon de travailler.",
  howItWorks:
    "🛒 Une page de commande à votre nom, avec paiement en ligne ou sur place.\n🤖 Un assistant WhatsApp qui répond à vos clients et les envoie vers la commande.\n📊 Un tableau de bord pour suivre les commandes en direct.",
  /** « Je veux le mien » (fusionné avec l'ancien « Obtenir ma démo ») : transfert à Jules, avec alerte. */
  wantMine: "Super ! Jules, de PFlow, vous recontacte très vite 🙂 Dites-nous déjà le nom de votre resto.",
  /** Filet de sécurité : rappel de l'étape en cours (avec son bouton), puis « C'est fait ? ». */
  remind1: "On en était à l'*étape 1/3* : passez commande comme un client 👇",
  remind2: "On en était à l'*étape 2/3* : voici ce que le resto voit, en direct 👇",
  remindDone: "C'est fait ? Touchez le bouton 👇",
  /** « 💬 Parler à Jules » (dans chaque rappel) : transfert à Jules, avec alerte. */
  talkToJules: "Pas de souci, Jules vous répond très vite 🙂",
  /** Question en plein parcours : Jules est prévenu (sans pause du bot), puis rappel de l'étape. */
  question: "Bonne question ! Jules vous répond très vite 🙂",
  /** Mot-clé d'une démo terminée (expirée ou supprimée). */
  demoEnded: (nom: string) =>
    `⏳ La démo de *${nom}* est terminée. Merci de l'avoir essayée ! Pour la prolonger ou passer à la vraie version, écrivez « Je veux le mien » : Jules vous recontacte 🙂`,
};

/**
 * Liens des étapes : variables du contact ({{demo_lien_commande}}, {{demo_lien_dashboard}}), avec son jeton quand
 * PFLOW_BOTS_SECRET est défini (src/demos/demo-auto.ts) ; sinon (simulateur, tests) les liens simples ci-dessous.
 */
const LIEN_COMMANDE = "{{demo_lien_commande}}";
const LIEN_DASHBOARD = "{{demo_lien_dashboard}}";
export const DEFAULT_DEMO_VARS: Record<string, string> = {
  demo_lien_commande: DEMO_PERMANENTE.commandeUrl,
  demo_lien_dashboard: DEMO_PERMANENTE.dashboardUrl,
  nom_demo: DEMO_PERMANENTE.nomResto,
};

/** Flux du bot PFlow de base : un bouton qui y mène fait quitter la démo en cours (voir router.ts). */
export const PFLOW_FLOW_PREFIX = "pflow-";

/** Ids des flux du parcours (stables : d'anciens boutons déjà envoyés les visent). */
export const PFLOW_FLOWS = {
  accueil: "pflow-accueil",
  etape1: "pflow-tester",
  etape2: "pflow-etape2",
  etape3: "pflow-etape3",
  rappel1: "pflow-rappel-1",
  rappel2: "pflow-rappel-2",
  commentCaMarche: "pflow-decouvrir",
  mien: "pflow-mien",
  rappel3: "pflow-rappel-3",
  jules: "pflow-jules",
  commandeDemo: "pflow-commande-demo",
  /** Question en plein parcours, puis rappel de l'étape N (pflow-question-0 … -3). */
  question: "pflow-question-",
} as const;

const replyTo = (flowId: string, title: string): ChoiceOption => ({ id: encodeReplyId({ flowId, nodeId: "t", handle: "next" }), title });

/**
 * Boutons PFlow ajoutés aux réponses d'une démo personnalisée sans carte : « Je veux le mien » (transfert à
 * Jules) et « Tester la démo » (le parcours Mint Bun). Leurs ids visent les flux du bot PFlow de base.
 */
export const PFLOW_DEMO_BUTTONS: ChoiceOption[] = [replyTo(PFLOW_FLOWS.mien, "🙋 Je veux le mien"), replyTo(PFLOW_FLOWS.etape1, "😋 Tester la démo")];

/** Mots qui lancent l'étape 1 (le plus long mot-clé gagne : « Bonjour je veux commander » va ici). */
export const TRY_DEMO_KEYWORDS = [
  "tester la demo", "tester", "voir la demo", "demo", "essai", "essayer", "commander", "je veux commander", "je commande",
  "passer commande", "la carte", "votre carte", "voir la carte", "voir le menu", "votre menu",
];
/** Textes préremplis des retours (et variantes écrites à la main) qui font passer à l'étape suivante. */
export const STEP2_KEYWORDS = ["j ai passe ma commande", "commande passee", "j ai commande", "commande envoyee"];
export const STEP3_KEYWORDS = ["j ai vu le dashboard", "dashboard vu", "j ai vu le tableau de bord"];
export const WANT_MINE_KEYWORDS = ["je veux le mien", "obtenir ma demo", "je veux une demo", "rappelez moi", "etre rappele"];
export const TALK_TO_JULES_KEYWORDS = ["parler a jules", "parler a quelqu un", "un humain", "une personne"];
const TALK_TO_JULES = "💬 Parler à Jules";

const welcome: Flow = {
  id: PFLOW_FLOWS.accueil,
  name: "PFlow — accueil",
  nodes: [
    trigger(["bonjour", "bonsoir", "salut", "hello", "coucou", "pflow"], { isDefault: true }),
    message("m", [{ text: PFLOW_TEXTS.welcome, buttons: [reply("tester", "Tester la démo")] }]),
    goto("g_tester", PFLOW_FLOWS.etape1, -200),
    // Anciens boutons de l'accueil (déjà envoyés à des prospects) : toujours compris.
    goto("g_decouvrir", PFLOW_FLOWS.commentCaMarche, 0),
    goto("g_demo", PFLOW_FLOWS.mien, 200),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "tester", target: "g_tester" },
    { id: "e3", source: "m", sourceHandle: "decouvrir", target: "g_decouvrir" },
    { id: "e4", source: "m", sourceHandle: "demo", target: "g_demo" },
  ],
};

const step1: Flow = {
  id: PFLOW_FLOWS.etape1,
  name: "PFlow — étape 1/3 : commander (Mint Bun)",
  nodes: [trigger(TRY_DEMO_KEYWORDS), message("m", [{ text: PFLOW_TEXTS.step1, buttons: [link("cmd", "Je commande", LIEN_COMMANDE)] }])],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const step2: Flow = {
  id: PFLOW_FLOWS.etape2,
  name: "PFlow — étape 2/3 : le dashboard",
  nodes: [trigger(STEP2_KEYWORDS), message("m", [{ text: PFLOW_TEXTS.step2, buttons: [link("dash", "Voir le dashboard", LIEN_DASHBOARD)] }])],
  edges: [{ id: "e1", source: "t", target: "m" }],
};

const step3: Flow = {
  id: PFLOW_FLOWS.etape3,
  name: "PFlow — étape 3/3 : et pour votre resto ?",
  nodes: [
    trigger(STEP3_KEYWORDS),
    message("m", [{ text: PFLOW_TEXTS.step3, buttons: [reply("mien", "🙋 Je veux le mien"), reply("comment", "Comment ça marche ?")] }]),
    goto("g_mien", PFLOW_FLOWS.mien, 0),
    goto("g_comment", PFLOW_FLOWS.commentCaMarche, 200),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "mien", target: "g_mien" },
    { id: "e3", source: "m", sourceHandle: "comment", target: "g_comment" },
  ],
};

/** Rappel d'une étape avec lien : le message de l'étape (son bouton), puis « C'est fait ? » [✅ C'est fait]. */
const reminder = (id: string, name: string, text: string, button: Button, next: string): Flow => ({
  id,
  name,
  nodes: [
    trigger([]),
    message("m", [{ text, buttons: [button] }]),
    { id: "d", type: "delay", position: at(340, 160), data: { mode: "intelligent" } },
    message("f", [{ text: PFLOW_TEXTS.remindDone, buttons: [reply("fait", "✅ C'est fait"), reply("jules", TALK_TO_JULES)] }], 320),
    goto("g", next, 320),
    goto("g_jules", PFLOW_FLOWS.jules, 480),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", target: "d" },
    { id: "e3", source: "d", target: "f" },
    { id: "e4", source: "f", sourceHandle: "fait", target: "g" },
    { id: "e5", source: "f", sourceHandle: "jules", target: "g_jules" },
  ],
});
const remind1 = reminder(PFLOW_FLOWS.rappel1, "PFlow — rappel étape 1/3", PFLOW_TEXTS.remind1, link("cmd", "Je commande", LIEN_COMMANDE), PFLOW_FLOWS.etape2);
const remind2 = reminder(PFLOW_FLOWS.rappel2, "PFlow — rappel étape 2/3", PFLOW_TEXTS.remind2, link("dash", "Voir le dashboard", LIEN_DASHBOARD), PFLOW_FLOWS.etape3);

/** Rappel de l'étape 3/3 : le même message, avec en plus [💬 Parler à Jules]. */
const remind3: Flow = {
  id: PFLOW_FLOWS.rappel3,
  name: "PFlow — rappel étape 3/3",
  nodes: [
    trigger([]),
    message("m", [
      { text: PFLOW_TEXTS.step3, buttons: [reply("mien", "🙋 Je veux le mien"), reply("comment", "Comment ça marche ?"), reply("jules", TALK_TO_JULES)] },
    ]),
    goto("g_mien", PFLOW_FLOWS.mien, 0),
    goto("g_comment", PFLOW_FLOWS.commentCaMarche, 200),
    goto("g_jules", PFLOW_FLOWS.jules, 400),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "mien", target: "g_mien" },
    { id: "e3", source: "m", sourceHandle: "comment", target: "g_comment" },
    { id: "e4", source: "m", sourceHandle: "jules", target: "g_jules" },
  ],
};

/** « 💬 Parler à Jules » : comme « Je veux le mien » (transfert + alerte, bot en pause pour ce contact). */
const talkToJules: Flow = {
  id: PFLOW_FLOWS.jules,
  name: "PFlow — parler à Jules",
  nodes: [trigger(TALK_TO_JULES_KEYWORDS), { id: "h", type: "handoff", position: at(340, 0), data: { text: PFLOW_TEXTS.talkToJules } }],
  edges: [{ id: "e1", source: "t", target: "h" }],
};

/**
 * Question en plein parcours (src/demos/parcours.ts) : « Bonne question ! … », puis le rappel de l'étape. Jules est
 * prévenu par le serveur (alerte sans pause : le prospect peut continuer la démo).
 */
const STEP_REMINDERS = [PFLOW_FLOWS.accueil, PFLOW_FLOWS.rappel1, PFLOW_FLOWS.rappel2, PFLOW_FLOWS.rappel3];
const questionFlows: Flow[] = STEP_REMINDERS.map((reminderId, etape) => ({
  id: `${PFLOW_FLOWS.question}${etape}`,
  name: `PFlow — question en plein parcours (étape ${etape})`,
  nodes: [
    trigger([]),
    message("m", [{ text: PFLOW_TEXTS.question }]),
    { id: "d", type: "delay", position: at(340, 160), data: { mode: "intelligent" } },
    goto("g", reminderId, 320),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", target: "d" },
    { id: "e3", source: "d", target: "g" },
  ],
}));

/** Commande de démo validée sur la page Mint Bun : la confirmation, puis l'étape 2/3 (événement envoyé par le serveur). */
const orderConfirmed: Flow = {
  id: PFLOW_FLOWS.commandeDemo,
  name: "PFlow — commande de démo confirmée",
  nodes: [
    { id: "t", type: "trigger", position: at(0, 0), data: { keywords: [], event: "commande_validee" } },
    message("m", [{ text: PFLOW_TEXTS.orderConfirmed }]),
    { id: "d", type: "delay", position: at(340, 160), data: { mode: "intelligent" } },
    goto("g", PFLOW_FLOWS.etape2, 320),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", target: "d" },
    { id: "e3", source: "d", target: "g" },
  ],
};

const howItWorks: Flow = {
  id: PFLOW_FLOWS.commentCaMarche,
  name: "PFlow — comment ça marche ?",
  nodes: [
    trigger(["comment ca marche", "pflow order", "decouvrir", "prix", "tarif", "tarifs"]),
    message("m", [{ text: PFLOW_TEXTS.howItWorks, buttons: [reply("mien", "🙋 Je veux le mien")] }]),
    goto("g_mien", PFLOW_FLOWS.mien, 0),
  ],
  edges: [
    { id: "e1", source: "t", target: "m" },
    { id: "e2", source: "m", sourceHandle: "mien", target: "g_mien" },
  ],
};

/** « Je veux le mien » : transfert à Jules, avec alerte (notification push + boîte de réception), bot en pause pour ce contact. */
const wantMine: Flow = {
  id: PFLOW_FLOWS.mien,
  name: "PFlow — je veux le mien",
  nodes: [trigger(WANT_MINE_KEYWORDS), { id: "h", type: "handoff", position: at(340, 0), data: { text: PFLOW_TEXTS.wantMine } }],
  edges: [{ id: "e1", source: "t", target: "h" }],
};

/** Le bot PFlow de base, prêt pour le moteur (sans IA : aucun coût). */
export function pflowBaseBot(): LoadedBot {
  return {
    client: { id: PFLOW_BOT_ID, nomResto: "PFlow", orderSlug: "", timezone: DEFAULT_TIMEZONE, vars: { ...DEFAULT_DEMO_VARS } },
    flows: structuredClone([welcome, step1, step2, step3, remind1, remind2, remind3, howItWorks, wantMine, talkToJules, ...questionFlows, orderConfirmed]),
    infoSheet: { horaires: [] },
    aiDailyLimit: 0,
  };
}
