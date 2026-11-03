import { normalize } from "./match";
import type { QuestionValidation } from "./types";

export type ValidationResult = { ok: true; value: string } | { ok: false };

const YES = new Set(["oui", "o", "ouais", "ouai", "yes", "y", "ok", "okay", "d accord", "dac", "bien sur", "exact", "oui oui", "carrement", "volontiers"]);
const NO = new Set(["non", "n", "no", "nope", "pas du tout", "non merci", "nan"]);

export function validateAnswer(raw: string, validation: QuestionValidation): ValidationResult {
  const text = raw.trim();
  switch (validation) {
    case "texte":
      return text ? { ok: true, value: text } : { ok: false };

    case "nombre": {
      const compact = text.replace(/\s/g, "");
      if (!/^-?\d+([.,]\d+)?$/.test(compact)) return { ok: false };
      return { ok: true, value: compact.replace(",", ".") };
    }

    case "telephone": {
      const compact = text.replace(/[\s.\-()]/g, "");
      // Format français (0690…, 0596…) ou international (+590…, 00596…).
      if (/^0\d{9}$/.test(compact)) return { ok: true, value: compact };
      if (/^\+\d{8,15}$/.test(compact)) return { ok: true, value: compact };
      if (/^00\d{8,15}$/.test(compact)) return { ok: true, value: `+${compact.slice(2)}` };
      return { ok: false };
    }

    case "oui_non": {
      const n = normalize(text);
      if (YES.has(n)) return { ok: true, value: "oui" };
      if (NO.has(n)) return { ok: true, value: "non" };
      return { ok: false };
    }
  }
}
