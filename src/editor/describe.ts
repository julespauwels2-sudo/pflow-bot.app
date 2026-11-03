import type { ConditionRule, IsoWeekday } from "@/engine";

const SHORT_DAYS: Record<IsoWeekday, string> = { 1: "lun", 2: "mar", 3: "mer", 4: "jeu", 5: "ven", 6: "sam", 7: "dim" };

const OPERATORS: Record<Extract<ConditionRule, { kind: "variable" }>["operator"], string> = {
  egal: "=",
  different: "≠",
  contient: "contient",
  existe: "est renseignée",
  vide: "est vide",
  superieur: ">",
  inferieur: "<",
};

export const OPERATOR_LABELS: Record<keyof typeof OPERATORS, string> = {
  egal: "est égale à",
  different: "est différente de",
  contient: "contient",
  existe: "est renseignée",
  vide: "est vide",
  superieur: "est supérieure à",
  inferieur: "est inférieure à",
};

/** Résumé court d'une règle de condition, affiché sur le bloc. */
export function describeRule(rule: ConditionRule): string {
  switch (rule.kind) {
    case "jour": {
      const days = [...rule.jours].sort();
      if (days.join() === "6,7") return "Le week-end (sam, dim)";
      if (days.join() === "1,2,3,4,5") return "En semaine (lun → ven)";
      return days.length ? `Jour : ${days.map((d) => SHORT_DAYS[d]).join(", ")}` : "Jour : aucun";
    }
    case "heure":
      return `Entre ${rule.de} et ${rule.a}`;
    case "ouvert_maintenant":
      return "Resto ouvert maintenant";
    case "variable": {
      const op = OPERATORS[rule.operator];
      const needsValue = rule.operator !== "existe" && rule.operator !== "vide";
      return `{{${rule.variable || "?"}}} ${op}${needsValue ? ` « ${rule.value ?? ""} »` : ""}`;
    }
  }
}
