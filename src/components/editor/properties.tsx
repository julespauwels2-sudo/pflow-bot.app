"use client";

import { useState, type ReactNode } from "react";
import { DELAY_MAX_SECONDS, TEXTS, WEEKDAY_LABELS, smartDelayMs, type ChoiceOption, type ConditionRule, type FlowNode, type IsoWeekday } from "@/engine";
import { BLOCKS, shortId } from "@/editor/catalog";
import { OPERATOR_LABELS } from "@/editor/describe";
import { WA_LIMITS } from "@/editor/limits";
import { useEditor } from "./context";
import { VariableField } from "./variable-field";

const inputCls =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-navy placeholder:text-muted/60 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-navy">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Counter({ value, max }: { value: string | undefined; max: number }) {
  const n = [...(value ?? "")].length;
  return <span className={`text-[11px] ${n > max ? "font-semibold text-coral" : "text-muted"}`}>{n}/{max}</span>;
}

/** Liste éditable de boutons ou de choix de liste. */
function OptionsEditor({
  options,
  max,
  titleMax,
  withDescription,
  onChange,
  addLabel,
  prefix,
}: {
  options: ChoiceOption[];
  /** Nombre maximum (limite WhatsApp). */
  max: number;
  titleMax: number;
  withDescription?: boolean;
  onChange: (options: ChoiceOption[], field: string) => void;
  addLabel: string;
  prefix: string;
}) {
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={o.id} className="rounded-xl border border-line p-2">
          <div className="flex items-center gap-1.5">
            <input
              className={inputCls}
              value={o.title}
              aria-label={`Titre ${i + 1}`}
              onChange={(e) => onChange(options.map((x) => (x.id === o.id ? { ...x, title: e.target.value } : x)), `${o.id}:title`)}
            />
            <Counter value={o.title} max={titleMax} />
          </div>
          {withDescription && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                className={inputCls}
                placeholder="Description (facultative)"
                value={o.description ?? ""}
                onChange={(e) =>
                  onChange(options.map((x) => (x.id === o.id ? { ...x, description: e.target.value || undefined } : x)), `${o.id}:desc`)
                }
              />
              <Counter value={o.description} max={WA_LIMITS.listRowDescription} />
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2 text-[11px] font-semibold">
            <button
              type="button"
              disabled={i === 0}
              className="text-muted hover:text-navy disabled:opacity-30"
              onClick={() => {
                const next = [...options];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next, "order");
              }}
            >
              ↑ Monter
            </button>
            <button type="button" className="text-coral hover:underline" onClick={() => onChange(options.filter((x) => x.id !== o.id), "remove")}>
              Supprimer
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={options.length >= max}
        className="w-full rounded-xl border border-dashed border-blue/40 py-2 text-sm font-semibold text-blue hover:bg-blue/5 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onChange([...options, { id: `${prefix}${shortId()}`, title: `${prefix === "b" ? "Option" : "Choix"} ${options.length + 1}` }], "add")}
      >
        + {addLabel} ({options.length}/{max})
      </button>
    </div>
  );
}

function KeywordsEditor({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() {
    const parts = draft.split(",").map((k) => k.trim()).filter(Boolean);
    if (parts.length) onChange([...keywords, ...parts.filter((p) => !keywords.includes(p))]);
    setDraft("");
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-pink/10 px-2.5 py-1 text-xs font-semibold text-pink">
            {k}
            <button type="button" aria-label={`Retirer ${k}`} onClick={() => onChange(keywords.filter((x) => x !== k))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        className={inputCls}
        value={draft}
        placeholder="commander, menu… puis Entrée"
        aria-label="Ajouter un mot-clé"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function RuleEditor({ rule, onChange, onRemove, variables }: { rule: ConditionRule; onChange: (r: ConditionRule) => void; onRemove: () => void; variables: string[] }) {
  return (
    <div className="space-y-2 rounded-xl border border-line p-2">
      <div className="flex gap-1.5">
        <select
          className={inputCls}
          value={rule.kind}
          aria-label="Type de règle"
          onChange={(e) => {
            const kind = e.target.value as ConditionRule["kind"];
            onChange(
              kind === "jour"
                ? { kind, jours: [6, 7] }
                : kind === "heure"
                  ? { kind, de: "11:00", a: "14:00" }
                  : kind === "variable"
                    ? { kind, variable: variables[0] ?? "", operator: "egal", value: "" }
                    : { kind },
            );
          }}
        >
          <option value="jour">Jour de la semaine</option>
          <option value="heure">Plage horaire</option>
          <option value="ouvert_maintenant">Resto ouvert (fiche d&apos;infos)</option>
          <option value="variable">Variable</option>
        </select>
        <button type="button" className="px-1 text-coral" aria-label="Supprimer la règle" onClick={onRemove}>
          ✕
        </button>
      </div>

      {rule.kind === "jour" && (
        <div className="flex flex-wrap gap-1">
          {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((d) => {
            const on = rule.jours.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${on ? "bg-navy text-white" : "bg-navy/5 text-muted"}`}
                onClick={() => onChange({ ...rule, jours: on ? rule.jours.filter((x) => x !== d) : [...rule.jours, d].sort() })}
              >
                {WEEKDAY_LABELS[d].slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      {rule.kind === "heure" && (
        <div className="flex items-center gap-2 text-sm">
          <input type="time" className={inputCls} value={rule.de} aria-label="De" onChange={(e) => onChange({ ...rule, de: e.target.value })} />
          <span className="text-muted">→</span>
          <input type="time" className={inputCls} value={rule.a} aria-label="À" onChange={(e) => onChange({ ...rule, a: e.target.value })} />
        </div>
      )}

      {rule.kind === "ouvert_maintenant" && <p className="text-[11px] text-muted">Vrai si l&apos;heure actuelle du resto est dans ses horaires d&apos;ouverture.</p>}

      {rule.kind === "variable" && (
        <div className="space-y-1.5">
          <input
            className={inputCls}
            list="pf-variables"
            placeholder="nom de la variable"
            value={rule.variable}
            aria-label="Variable"
            onChange={(e) => onChange({ ...rule, variable: e.target.value })}
          />
          <datalist id="pf-variables">
            {variables.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <select className={inputCls} value={rule.operator} aria-label="Opérateur" onChange={(e) => onChange({ ...rule, operator: e.target.value as typeof rule.operator })}>
            {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {rule.operator !== "existe" && rule.operator !== "vide" && (
            <input className={inputCls} placeholder="valeur" value={rule.value ?? ""} aria-label="Valeur" onChange={(e) => onChange({ ...rule, value: e.target.value })} />
          )}
        </div>
      )}
    </div>
  );
}

function Fields({ node, set }: { node: FlowNode; set: (patch: Record<string, unknown>, field: string) => void }) {
  const { variables, flows, flowId, orderUrl } = useEditor();
  const vf = (field: string, value: string | undefined, opts: { multiline?: boolean; placeholder?: string; max?: number } = {}) => (
    <VariableField value={value ?? ""} variables={variables} onChange={(v) => set({ [field]: v }, field)} ariaLabel={field} {...opts} />
  );

  switch (node.type) {
    case "trigger":
      return (
        <>
          <label className="flex items-start gap-2 rounded-xl border border-line p-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-pink"
              checked={node.data.isDefault ?? false}
              onChange={(e) => set({ isDefault: e.target.checked || undefined }, "isDefault")}
            />
            <span>
              <span className="block text-sm font-semibold">Flux par défaut</span>
              <span className="block text-[11px] text-muted">
                Se lance sur n&apos;importe quel message quand aucun mot-clé ne correspond et qu&apos;aucune conversation n&apos;est
                en cours. Un seul par client. Interdit en mode « mots-clés uniquement » (numéro perso du gérant).
              </span>
            </span>
          </label>
          <Row label="Mots-clés" hint="Casse et accents ignorés. « commander » reconnaît « Je veux COMMANDER ! ».">
            <KeywordsEditor keywords={node.data.keywords} onChange={(keywords) => set({ keywords }, "keywords")} />
          </Row>
          <Row label="Correspondance">
            <select className={inputCls} value={node.data.matchMode ?? "contient"} onChange={(e) => set({ matchMode: e.target.value }, "matchMode")}>
              <option value="contient">Le message contient le mot-clé</option>
              <option value="exact">Le message est exactement le mot-clé</option>
            </select>
          </Row>
        </>
      );

    case "message": {
      const buttons = node.data.buttons ?? [];
      return (
        <>
          <Row label="Texte">
            {vf("text", node.data.text, {
              multiline: true,
              max: buttons.length ? WA_LIMITS.interactiveBody : WA_LIMITS.textBody,
              placeholder: "Bonjour {{prenom}} 👋",
            })}
          </Row>
          <Row
            label="Boutons de réponse (facultatif)"
            hint="Chaque bouton a sa propre sortie. Pour un bouton qui ouvre un lien, utilisez le bloc « Lien de commande » : WhatsApp ne mélange pas les deux."
          >
            <OptionsEditor
              options={buttons}
              max={WA_LIMITS.buttonsMax}
              titleMax={WA_LIMITS.buttonTitle}
              addLabel="Ajouter un bouton"
              prefix="b"
              onChange={(next, field) => set({ buttons: next.length ? next : undefined }, `buttons:${field}`)}
            />
          </Row>
        </>
      );
    }

    case "delay": {
      const mode = node.data.mode;
      return (
        <>
          <Row label="Durée">
            <div className="space-y-2">
              {(["intelligent", "fixe"] as const).map((m) => (
                <label key={m} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
                  <input type="radio" name={`delay-${node.id}`} className="mt-0.5 accent-pink" checked={mode === m} onChange={() => set({ mode: m }, "mode")} />
                  <span>
                    <span className="block text-sm font-semibold">{m === "intelligent" ? "Délai intelligent" : "Durée fixe"}</span>
                    <span className="block text-[11px] text-muted">
                      {m === "intelligent"
                        ? `Le temps de taper le message suivant : ${smartDelayMs("") / 1000} s pour un message court, jusqu'à 5 s pour un long.`
                        : `Entre 0,5 et ${DELAY_MAX_SECONDS} secondes.`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Row>
          {mode === "fixe" && (
            <Row label="Secondes">
              <input
                type="number"
                min={0.5}
                max={DELAY_MAX_SECONDS}
                step={0.5}
                className={inputCls}
                value={node.data.seconds ?? 2}
                onChange={(e) => set({ seconds: Number(e.target.value) }, "seconds")}
              />
            </Row>
          )}
          <p className="text-[11px] text-muted">Pendant la pause, le client voit « en train d&apos;écrire… » dans WhatsApp.</p>
        </>
      );
    }

    case "buttons":
      return (
        <>
          <Row label="Texte au-dessus des boutons">{vf("text", node.data.text, { multiline: true, max: WA_LIMITS.interactiveBody })}</Row>
          <Row label="Boutons" hint="Chaque bouton a sa propre sortie à relier.">
            <OptionsEditor
              options={node.data.buttons}
              max={WA_LIMITS.buttonsMax}
              titleMax={WA_LIMITS.buttonTitle}
              addLabel="Ajouter un bouton"
              prefix="b"
              onChange={(buttons, field) => set({ buttons }, `buttons:${field}`)}
            />
          </Row>
        </>
      );

    case "list":
      return (
        <>
          <Row label="Texte">{vf("text", node.data.text, { multiline: true, max: WA_LIMITS.interactiveBody })}</Row>
          <Row label="Libellé du bouton qui ouvre la liste">
            <div className="flex items-center gap-1.5">
              <input className={inputCls} value={node.data.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value }, "buttonLabel")} />
              <Counter value={node.data.buttonLabel} max={WA_LIMITS.listButtonLabel} />
            </div>
          </Row>
          <Row label="Choix">
            <OptionsEditor
              options={node.data.items}
              max={WA_LIMITS.listRowsMax}
              titleMax={WA_LIMITS.listRowTitle}
              withDescription
              addLabel="Ajouter un choix"
              prefix="i"
              onChange={(items, field) => set({ items }, `items:${field}`)}
            />
          </Row>
        </>
      );

    case "question":
      return (
        <>
          <Row label="Question">{vf("text", node.data.text, { multiline: true, placeholder: "Pour combien de personnes ?" })}</Row>
          <Row label="Enregistrer la réponse dans la variable" hint="Utilisable ensuite avec le menu {x}.">
            <input
              className={`${inputCls} font-mono`}
              value={node.data.variable}
              onChange={(e) => set({ variable: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }, "variable")}
            />
          </Row>
          <Row label="Type de réponse attendue">
            <select className={inputCls} value={node.data.validation} onChange={(e) => set({ validation: e.target.value }, "validation")}>
              <option value="texte">Texte</option>
              <option value="nombre">Nombre</option>
              <option value="telephone">Téléphone</option>
              <option value="oui_non">Oui / non</option>
            </select>
          </Row>
          <Row label="Message si la réponse est invalide" hint="Laissez vide pour le message par défaut.">
            {vf("errorText", node.data.errorText, { placeholder: TEXTS.questionError[node.data.validation] })}
          </Row>
          <Row label="Nombre d'essais avant la sortie « échec »">
            <input
              type="number"
              min={0}
              max={10}
              className={inputCls}
              value={node.data.maxRetries ?? 2}
              onChange={(e) => set({ maxRetries: Math.max(0, Math.min(10, Number(e.target.value) || 0)) }, "maxRetries")}
            />
          </Row>
        </>
      );

    case "condition": {
      const names = variables.map((v) => v.name);
      return (
        <>
          <Row label="Combinaison">
            <select className={inputCls} value={node.data.match ?? "toutes"} onChange={(e) => set({ match: e.target.value }, "match")}>
              <option value="toutes">Toutes les règles sont vraies (ET)</option>
              <option value="une">Au moins une règle est vraie (OU)</option>
            </select>
          </Row>
          <Row label="Règles" hint="Jours et heures dans le fuseau horaire du client.">
            <div className="space-y-2">
              {node.data.rules.map((rule, i) => (
                <RuleEditor
                  key={i}
                  rule={rule}
                  variables={names}
                  onChange={(r) => set({ rules: node.data.rules.map((x, j) => (j === i ? r : x)) }, `rule:${i}`)}
                  onRemove={() => set({ rules: node.data.rules.filter((_, j) => j !== i) }, "rules")}
                />
              ))}
              <button
                type="button"
                className="w-full rounded-xl border border-dashed border-blue/40 py-2 text-sm font-semibold text-blue hover:bg-blue/5"
                onClick={() => set({ rules: [...node.data.rules, { kind: "jour", jours: [6, 7] }] }, "rules")}
              >
                + Ajouter une règle
              </button>
            </div>
          </Row>
        </>
      );
    }

    case "order_link":
      return (
        <>
          <Row label="Texte" hint={`Lien envoyé : ${orderUrl}`}>
            {vf("text", node.data.text, { multiline: true, placeholder: TEXTS.orderLink })}
          </Row>
          <Row label="Libellé du bouton">
            <div className="flex items-center gap-1.5">
              <input className={inputCls} placeholder={TEXTS.orderButton} value={node.data.buttonLabel ?? ""} onChange={(e) => set({ buttonLabel: e.target.value || undefined }, "buttonLabel")} />
              <Counter value={node.data.buttonLabel} max={WA_LIMITS.ctaButtonLabel} />
            </div>
          </Row>
        </>
      );

    case "ai":
      return (
        <>
          <Row label="Message d'introduction" hint="Envoyé en arrivant sur ce bloc (facultatif).">
            {vf("intro", node.data.intro, { multiline: true })}
          </Row>
          <Row label="Consignes pour l'IA" hint="Ex. : « Réponds surtout aux questions sur la livraison. » L'IA ne donne jamais de prix ni de disponibilité absents de la fiche.">
            <textarea className={`${inputCls} min-h-20`} value={node.data.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value || undefined }, "instructions")} />
          </Row>
        </>
      );

    case "handoff":
      return (
        <Row label="Message au client" hint="Le bot se met ensuite en pause pour ce contact (24 h) et le gérant est prévenu.">
          {vf("text", node.data.text, { multiline: true, placeholder: TEXTS.handoff })}
        </Row>
      );

    case "goto_flow":
      return (
        <Row label="Flux de destination">
          <select className={inputCls} value={node.data.flowId} onChange={(e) => set({ flowId: e.target.value }, "flowId")}>
            <option value="">— Choisir un flux —</option>
            {flows
              .filter((f) => f.id !== flowId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </Row>
      );

    case "end":
      return <Row label="Dernier message (facultatif)">{vf("text", node.data.text, { multiline: true, placeholder: "Merci et à bientôt !" })}</Row>;
  }
}

export function NodeProperties({ node, onDuplicate, onDelete }: { node: FlowNode; onDuplicate: () => void; onDelete: () => void }) {
  const { updateData, issues } = useEditor();
  const info = BLOCKS[node.type];
  const nodeIssues = issues.get(node.id) ?? [];

  const set = (patch: Record<string, unknown>, field: string) => {
    const data = { ...node.data, ...patch };
    // Les champs facultatifs remis à `undefined` sont retirés (un texte vide reste une chaîne vide).
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (data as Record<string, unknown>)[k];
    updateData(node.id, data as FlowNode["data"], `${node.id}:${field}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`grid size-8 place-items-center rounded-xl ${info.accent}`}>{info.icon}</span>
        <div>
          <h2 className="font-title text-base font-semibold">{info.label}</h2>
          <p className="text-xs text-muted">{info.description}</p>
        </div>
      </div>

      {nodeIssues.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-coral/5 p-2.5 text-xs">
          {nodeIssues.map((i, k) => (
            <li key={k} className={i.level === "error" ? "font-semibold text-coral" : "text-amber-700"}>
              {i.level === "error" ? "⚠" : "•"} {i.message}
            </li>
          ))}
        </ul>
      )}

      <Fields node={node} set={set} />

      {node.type !== "trigger" && (
        <div className="flex gap-2 border-t border-rule pt-3">
          <button type="button" className="flex-1 rounded-full border border-line py-1.5 text-sm font-semibold hover:border-navy/30" onClick={onDuplicate}>
            Dupliquer
          </button>
          <button type="button" className="flex-1 rounded-full border border-coral/40 py-1.5 text-sm font-semibold text-coral hover:bg-coral/10" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

