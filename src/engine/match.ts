import type { Flow, FlowNodeOf } from "./types";

/**
 * Normalise un texte pour la comparaison : minuscules, sans accents,
 * ponctuation remplacée par des espaces, espaces multiples réduits.
 */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Vrai si le mot-clé apparaît dans le message (mots entiers, casse et accents ignorés). */
export function keywordMatches(
  message: string,
  keyword: string,
  mode: "contient" | "exact" = "contient",
): boolean {
  const msg = normalize(message);
  const kw = normalize(keyword);
  if (!kw) return false;
  if (mode === "exact") return msg === kw;
  return ` ${msg} `.includes(` ${kw} `);
}

export function findTrigger(flow: Flow): FlowNodeOf<"trigger"> | undefined {
  return flow.nodes.find((n): n is FlowNodeOf<"trigger"> => n.type === "trigger");
}

/** Flux par défaut du client (le premier si, par erreur, il y en a plusieurs). */
export function findDefaultFlow(flows: Flow[]): Flow | undefined {
  return flows.find((f) => findTrigger(f)?.data.isDefault);
}

/**
 * Cherche le flux dont un mot-clé correspond au message.
 * En cas de plusieurs correspondances, le mot-clé le plus long gagne
 * (« carte du midi » l'emporte sur « carte »), puis l'ordre des flux.
 */
export function matchFlowByKeyword(flows: Flow[], message: string): Flow | undefined {
  let best: { flow: Flow; length: number } | undefined;
  for (const flow of flows) {
    const trigger = findTrigger(flow);
    if (!trigger) continue;
    for (const keyword of trigger.data.keywords) {
      if (!keywordMatches(message, keyword, trigger.data.matchMode)) continue;
      const length = normalize(keyword).length;
      if (!best || length > best.length) best = { flow, length };
    }
  }
  return best?.flow;
}
