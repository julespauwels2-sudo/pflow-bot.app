/**
 * Aiguillage du numéro PFlow (partagé par toutes les démos) — fonction pure, utilisée par le serveur
 * (webhook) et par le simulateur :
 * 1. un mot-clé de démo est prioritaire sur tout (y compris les mots-clés du modèle) ;
 * 2. sinon, le contact reste dans sa démo tant que sa session vit (inactivité < sessionMinutes) ;
 * 3. sinon, le bot PFlow de base répond.
 * Mot-clé : message identique au mot-clé (casse, accents et ponctuation ignorés) ou « démo <mot-clé> ».
 * Hors d'une démo, le mot-clé peut aussi être au milieu d'un court message (« Bonjour Byron »).
 */
import { keywordMatches, type IncomingMessage } from "@/engine";
import type { DemoRecord } from "@/data/types";
import { normalizeKeyword } from "./keyword";
import { isDemoActive } from "./lifecycle";

/** Démo en cours d'un contact du numéro PFlow (gardée avec le contact). */
export interface ContactDemo {
  clientId: string;
  /** Dernier message du contact dans cette démo (fin de session après inactivité). */
  lastAt: string;
  /** Démos déjà ouvertes par ce contact (compteur de conversations par démo). */
  visited: string[];
}

export type DemoRoute =
  /** entered : la démo vient d'être ouverte par son mot-clé (repartir de zéro). */
  | { kind: "demo"; clientId: string; entered: boolean }
  /** Mot-clé d'une démo terminée : message poli, retour au bot PFlow. */
  | { kind: "ended"; clientId: string; nomResto: string }
  | { kind: "pflow" };

export interface DemoDirectoryEntry extends DemoRecord {
  nomResto: string;
}

const MAX_WORDS_INSIDE = 5;

function keywordHit(text: string, keyword: string, inDemo: boolean): boolean {
  const msg = normalizeKeyword(text);
  const kw = normalizeKeyword(keyword);
  if (!kw || !msg) return false;
  if (msg === kw || msg === `demo ${kw}`) return true;
  // Hors démo, un court message qui contient le nom (« Bonjour Byron ! ») suffit.
  return !inDemo && msg.split(" ").length <= MAX_WORDS_INSIDE && keywordMatches(msg, kw);
}

export function routePflowMessage(input: {
  message: IncomingMessage;
  demos: DemoDirectoryEntry[];
  current: ContactDemo | undefined;
  now: Date;
  sessionMinutes: number;
}): DemoRoute {
  const { message, demos, current, now, sessionMinutes } = input;
  const currentDemo = current ? demos.find((d) => d.clientId === current.clientId) : undefined;
  const sessionAlive =
    Boolean(current && currentDemo && isDemoActive(currentDemo, now)) && now.getTime() - Date.parse(current!.lastAt) < sessionMinutes * 60_000;

  if (message.kind === "text") {
    // Le mot-clé le plus long gagne (« Byron Burger » avant « Byron »).
    const hits = demos
      .filter((d) => keywordHit(message.text, d.keyword, sessionAlive))
      .sort((a, b) => normalizeKeyword(b.keyword).length - normalizeKeyword(a.keyword).length);
    const active = hits.find((d) => isDemoActive(d, now));
    if (active) return { kind: "demo", clientId: active.clientId, entered: true };
    if (hits[0]) return { kind: "ended", clientId: hits[0].clientId, nomResto: hits[0].nomResto };
  }
  if (sessionAlive) return { kind: "demo", clientId: current!.clientId, entered: false };
  return { kind: "pflow" };
}

/** Démo en cours du contact après ce message. */
export function nextContactDemo(current: ContactDemo | undefined, route: DemoRoute, now: Date): ContactDemo | undefined {
  if (route.kind !== "demo") return current ? { ...current, clientId: "", lastAt: now.toISOString() } : undefined;
  const visited = current?.visited ?? [];
  return {
    clientId: route.clientId,
    lastAt: now.toISOString(),
    visited: visited.includes(route.clientId) ? visited : [...visited, route.clientId],
  };
}
