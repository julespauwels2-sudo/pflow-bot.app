import { normalize } from "./match";
import { inRange, isOpenAt, localTime } from "./time";
import type { ConditionRule, InfoSheet } from "./types";

export interface ConditionContext {
  now: Date;
  timezone: string;
  vars: Record<string, string | undefined>;
  infoSheet: InfoSheet;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.trim().replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function evaluateRule(rule: ConditionRule, ctx: ConditionContext): boolean {
  switch (rule.kind) {
    case "jour":
      return rule.jours.includes(localTime(ctx.now, ctx.timezone).weekday);

    case "heure":
      return inRange(localTime(ctx.now, ctx.timezone).minutes, rule.de, rule.a);

    case "ouvert_maintenant":
      return isOpenAt(ctx.infoSheet.horaires, ctx.now, ctx.timezone);

    case "variable": {
      const actual = ctx.vars[rule.variable];
      const expected = rule.value ?? "";
      switch (rule.operator) {
        case "existe":
          return actual !== undefined && actual.trim() !== "";
        case "vide":
          return actual === undefined || actual.trim() === "";
        case "egal":
          return actual !== undefined && normalize(actual) === normalize(expected);
        case "different":
          return actual === undefined || normalize(actual) !== normalize(expected);
        case "contient":
          return actual !== undefined && normalize(actual).includes(normalize(expected));
        case "superieur":
        case "inferieur": {
          const a = toNumber(actual);
          const b = toNumber(expected);
          if (a === null || b === null) return false;
          return rule.operator === "superieur" ? a > b : a < b;
        }
      }
    }
  }
}

/** Évalue toutes les règles d'un bloc Condition. Sans règle, la condition est vraie. */
export function evaluateConditions(
  rules: ConditionRule[],
  match: "toutes" | "une",
  ctx: ConditionContext,
): boolean {
  if (rules.length === 0) return true;
  return match === "une"
    ? rules.some((r) => evaluateRule(r, ctx))
    : rules.every((r) => evaluateRule(r, ctx));
}
