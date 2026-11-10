"use client";

import { useState, type ReactNode } from "react";
import { DELAY_MAX_SECONDS, ORDER_EVENTS, ORDER_EVENT_TYPES, TEXTS, WEEKDAY_LABELS, smartDelayMs, type ChoiceOption, type ConditionRule, type FlowNode, type IsoWeekday } from "@/engine";
import { BLOCKS, shortId } from "@/editor/catalog";
import {
  addBubble,
  addLinkButton,
  addReplyButton,
  canAddBubble,
  canAddLink,
  canAddReply,
  moveBubble,
  removeBubble,
  removeButton,
  setBubbleText,
  updateButton,
} from "@/editor/bubbles";
import { OPERATOR_LABELS } from "@/editor/describe";
import { WA_LIMITS } from "@/editor/limits";
import { useEditor } from "./context";
import { VariableField } from "./variable-field";

const inputCls =
  "w-full rounded-xl border border-line carte px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Counter({ value, max }: { value: string | undefined; max: number }) {
  const n = [...(value ?? "")].length;
  return <span className={`text-[11px] ${n > max ? "font-semibold text-alerte" : "text-muted"}`}>{n}/{max}</span>;
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
              className="text-muted hover:text-ink disabled:opacity-30"
              onClick={() => {
                const next = [...options];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next, "order");
              }}
            >
              ↑ Monter
            </button>
            <button type="button" className="text-alerte hover:underline" onClick={() => onChange(options.filter((x) => x.id !== o.id), "remove")}>
              Supprimer
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={options.length >= max}
        className="w-full rounded-xl border border-dashed border-blue/40 py-2 text-sm font-semibold text-bleu hover:bg-blue/5 disabled:cursor-not-allowed disabled:opacity-40"
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
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-pink/10 px-2.5 py-1 text-xs font-semibold text-rose">
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
        <button type="button" className="px-1 text-alerte" aria-label="Supprimer la règle" onClick={onRemove}>
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
                className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${on ? "bg-navy-2 text-white" : "bg-ink/5 text-muted"}`}
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

/** Bulles du bloc Message : texte, boutons de réponse ou bouton lien (jamais les deux). */
function MessageFields({ node }: { node: Extract<FlowNode, { type: "message" }> }) {
  const { updateData, variables, orderUrl } = useEditor();
  const data = node.data;
  const update = (next: typeof data, field: string) => updateData(node.id, next, `${node.id}:${field}`);

  return (
    <div className="space-y-3">
      {data.bubbles.map((bubble, i) => {
        const reply = canAddReply(bubble);
        const link = canAddLink(bubble);
        const interactive = bubble.buttons.length > 0;
        return (
          <div key={bubble.id} className="space-y-2 rounded-2xl border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">Bulle {i + 1}</p>
              <div className="flex gap-2 text-[11px] font-semibold">
                <button type="button" disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30" onClick={() => update(moveBubble(data, bubble.id, -1), "bubble:move")}>
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === data.bubbles.length - 1}
                  className="text-muted hover:text-ink disabled:opacity-30"
                  onClick={() => update(moveBubble(data, bubble.id, 1), "bubble:move")}
                >
                  ↓
                </button>
                <button type="button" disabled={data.bubbles.length <= 1} className="text-alerte hover:underline disabled:opacity-30" onClick={() => update(removeBubble(data, bubble.id), "bubble:remove")}>
                  Supprimer
                </button>
              </div>
            </div>
            <VariableField
              ariaLabel={`Texte de la bulle ${i + 1}`}
              value={bubble.text}
              variables={variables}
              multiline
              max={interactive ? WA_LIMITS.interactiveBody : WA_LIMITS.textBody}
              placeholder="👋 Hello {{prenom}} !"
              onChange={(text) => update(setBubbleText(data, bubble.id, text), `${bubble.id}:text`)}
            />

            {bubble.buttons.map((b) =>
              b.kind === "reply" ? (
                <div key={b.id} className="flex items-center gap-1.5">
                  <span className="text-xs text-bleu" title="Bouton de réponse">↩︎</span>
                  <input
                    className={inputCls}
                    aria-label="Titre du bouton de réponse"
                    value={b.title}
                    onChange={(e) => update(updateButton(data, bubble.id, { ...b, title: e.target.value }), `${b.id}:title`)}
                  />
                  <Counter value={b.title} max={WA_LIMITS.buttonTitle} />
                  <button type="button" aria-label="Supprimer le bouton" className="px-1 text-alerte" onClick={() => update(removeButton(data, bubble.id, b.id), "button:remove")}>
                    ✕
                  </button>
                </div>
              ) : (
                <div key={b.id} className="space-y-1.5 rounded-xl bg-ink/5 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" title="Bouton lien">🔗</span>
                    <input
                      className={inputCls}
                      aria-label="Titre du bouton lien"
                      value={b.title}
                      onChange={(e) => update(updateButton(data, bubble.id, { ...b, title: e.target.value }), `${b.id}:title`)}
                    />
                    <Counter value={b.title} max={WA_LIMITS.ctaButtonLabel} />
                    <button type="button" aria-label="Supprimer le bouton" className="px-1 text-alerte" onClick={() => update(removeButton(data, bubble.id, b.id), "button:remove")}>
                      ✕
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 accent-pink"
                      checked={b.orderLink ?? false}
                      onChange={(e) =>
                        update(
                          updateButton(data, bubble.id, e.target.checked ? { id: b.id, kind: "link", title: b.title, orderLink: true } : { id: b.id, kind: "link", title: b.title, url: "https://" }),
                          `${b.id}:orderLink`,
                        )
                      }
                    />
                    Lien de commande du client
                  </label>
                  {b.orderLink ? (
                    <p className="truncate text-[11px] text-muted">{orderUrl}</p>
                  ) : (
                    <VariableField
                      ariaLabel="URL du bouton lien"
                      value={b.url ?? ""}
                      variables={variables}
                      placeholder="https://…"
                      onChange={(url) => update(updateButton(data, bubble.id, { ...b, url }), `${b.id}:url`)}
                    />
                  )}
                </div>
              ),
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!reply.allowed}
                title={reply.reason}
                className="rounded-xl border border-dashed border-blue/40 py-1.5 text-xs font-semibold text-bleu hover:bg-blue/5 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => update(addReplyButton(data, bubble.id), "reply:add")}
              >
                + Bouton de réponse
              </button>
              <button
                type="button"
                disabled={!link.allowed}
                title={link.reason}
                className="rounded-xl border border-dashed border-blue/40 py-1.5 text-xs font-semibold text-bleu hover:bg-blue/5 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => update(addLinkButton(data, bubble.id), "link:add")}
              >
                + Bouton lien
              </button>
            </div>
            {[...new Set([reply.reason, link.reason].filter(Boolean))].map((reason) => (
              <p key={reason} className="text-[11px] text-muted">
                {reason}
              </p>
            ))}
          </div>
        );
      })}
      <button
        type="button"
        disabled={!canAddBubble(data)}
        className="w-full rounded-xl border border-dashed border-line py-2 text-sm font-semibold text-muted hover:border-ink/30 hover:text-ink disabled:opacity-40"
        onClick={() => update(addBubble(data), "bubble:add")}
      >
        + Ajouter une bulle
      </button>
      <p className="text-[11px] text-muted">
        <strong>Étape suivante</strong> reliée : la suite part tout de suite et les boutons restent cliquables. Non reliée : le bot attend un clic.
      </p>
    </div>
  );
}

function Fields({ node, set }: { node: FlowNode; set: (patch: Record<string, unknown>, field: string) => void }) {
  const { variables, flows, flowId, agentFunctions = [] } = useEditor();
  const vf = (field: string, value: string | undefined, opts: { multiline?: boolean; placeholder?: string; max?: number } = {}) => (
    <VariableField value={value ?? ""} variables={variables} onChange={(v) => set({ [field]: v }, field)} ariaLabel={field} {...opts} />
  );

  switch (node.type) {
    case "trigger": {
      const event = node.data.event;
      return (
        <>
          <Row label="Type de déclencheur">
            <select
              className={inputCls}
              aria-label="Type de déclencheur"
              value={event ? "evenement" : "mots_cles"}
              onChange={(e) =>
                set(e.target.value === "evenement" ? { event: "commande_validee", isDefault: undefined } : { event: undefined }, "triggerType")
              }
            >
              <option value="mots_cles">Message du client (mots-clés)</option>
              <option value="evenement">Événement PFlow Order (commande validée, prête…)</option>
            </select>
          </Row>

          {event ? (
            <>
              <Row label="Événement" hint={ORDER_EVENTS[event].description}>
                <select className={inputCls} aria-label="Événement" value={event} onChange={(e) => set({ event: e.target.value }, "event")}>
                  {ORDER_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ORDER_EVENTS[t].icon} {ORDER_EVENTS[t].label}
                    </option>
                  ))}
                </select>
              </Row>
              <p className="rounded-xl bg-ink/5 p-2.5 text-[11px] text-muted">
                Envoyé seulement si le client a écrit au bot depuis moins de 24 h (sinon : rien). Envoyé même si le bot est en pause pour ce
                contact, sans relancer la conversation. Branchement avec PFlow Order à l&apos;étape C.
              </p>
              <Row label="Variables apportées par l'événement">
                <ul className="space-y-1 text-[11px]">
                  {ORDER_EVENTS[event].variables.map((v) => (
                    <li key={v.name}>
                      <span className="font-mono font-semibold text-rose">{`{{${v.name}}}`}</span> <span className="text-muted">· {v.label}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            </>
          ) : (
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
                    Se lance sur n&apos;importe quel message quand aucun mot-clé ne correspond et qu&apos;aucune conversation n&apos;est en cours.
                    Un seul par client. Interdit en mode « mots-clés uniquement » (numéro perso du gérant).
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
          )}
        </>
      );
    }

    case "message":
      return <MessageFields node={node} />;

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
                className="w-full rounded-xl border border-dashed border-blue/40 py-2 text-sm font-semibold text-bleu hover:bg-blue/5"
                onClick={() => set({ rules: [...node.data.rules, { kind: "jour", jours: [6, 7] }] }, "rules")}
              >
                + Ajouter une règle
              </button>
            </div>
          </Row>
        </>
      );
    }

    case "ai": {
      const allowed = node.data.functions;
      const unknown = (allowed ?? []).filter((n) => !agentFunctions.some((f) => f.name === n));
      const toggle = (name: string, on: boolean) => {
        const current = allowed ?? agentFunctions.map((f) => f.name);
        const next = on ? [...new Set([...current, name])] : current.filter((n) => n !== name);
        set({ functions: next }, "functions");
      };
      return (
        <>
          <p className="rounded-xl bg-ink/5 p-2.5 text-[11px] text-muted">
            Le bot reste sur ce bloc : l&apos;IA répond à chaque message avec la fiche d&apos;infos du client, jusqu&apos;à une fonction, un transfert,
            un mot-clé ou le délai d&apos;inactivité.
          </p>
          <label className="flex items-start gap-2 rounded-xl bg-ink/5 p-2.5 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 accent-pink"
              checked={Boolean(node.data.choixCarte)}
              onChange={(e) => set({ choixCarte: e.target.checked || undefined }, "choixCarte")}
            />
            <span>
              <span className="block font-semibold">Proposer des choix de la carte (boutons)</span>
              <span className="text-[11px] text-muted">
                Le bot envoie d&apos;abord les familles de la carte (ou la liste « Choix de « Me conseiller » » de la fiche) et « 🎲 Surprenez-moi » ;
                au clic, l&apos;IA recommande 2 ou 3 produits avec les prix, puis « 🛒 Commander » et « 🔄 Autre chose ». Marche aussi en mode
                mots-clés uniquement.
              </span>
            </span>
          </label>
          <Row label="Message d'introduction" hint="Envoyé en arrivant sur ce bloc (facultatif).">
            {vf("intro", node.data.intro, { multiline: true })}
          </Row>
          <Row
            label="Texte d'entrée"
            hint="Facultatif. S'il est rempli, l'IA est appelée tout de suite avec ce texte, sans attendre de message. Ex. : « Le client a choisi le goût chocolat, propose-lui 2 cookies. »"
          >
            {vf("input", node.data.input, { multiline: true, placeholder: "Le client a choisi {{choix}}…" })}
          </Row>
          <Row label="Consigne pour cette étape" hint="Ajoutée à la consigne de l'agent. L'IA ne donne jamais de prix ni de disponibilité absents de la fiche.">
            <textarea
              aria-label="Consigne pour cette étape"
              className={`${inputCls} min-h-20`}
              value={node.data.instructions ?? ""}
              onChange={(e) => set({ instructions: e.target.value || undefined }, "instructions")}
            />
          </Row>
          <Row
            label="Fonctions autorisées"
            hint={
              agentFunctions.length
                ? "Chaque fonction lance un flux du modèle. Décochées : l'IA ne peut que répondre ou passer la main."
                : "Aucune fonction : configure l'agent IA du modèle maître (page Modèle maître → Agent IA)."
            }
          >
            <div className="space-y-1">
              {agentFunctions.map((f) => (
                <label key={f.name} className="flex items-start gap-2 text-xs" title={f.description}>
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-pink"
                    checked={!allowed || allowed.includes(f.name)}
                    onChange={(e) => toggle(f.name, e.target.checked)}
                  />
                  <span className="font-mono">{f.name}</span>
                </label>
              ))}
              {unknown.length > 0 && <p className="text-[11px] font-semibold text-alerte">Fonctions inconnues de l&apos;agent : {unknown.join(", ")}</p>}
              {allowed && agentFunctions.length > 0 && (
                <button type="button" className="text-[11px] font-semibold text-bleu" onClick={() => set({ functions: undefined }, "functions")}>
                  Toutes les fonctions de l&apos;agent
                </button>
              )}
            </div>
          </Row>
          <Row label="Délai d'inactivité (minutes)" hint="Sans message du client pendant ce délai, l'IA lâche la conversation. Vide : réglage de l'agent (10 min par défaut).">
            <input
              type="number"
              min={1}
              max={1440}
              aria-label="Délai d'inactivité"
              className={inputCls}
              value={node.data.inactivityMinutes ?? ""}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                set({ inactivityMinutes: e.target.value && n >= 1 ? Math.min(n, 1440) : undefined }, "inactivityMinutes");
              }}
            />
          </Row>
        </>
      );
    }

    case "handoff":
      return (
        <Row label="Message au client" hint="Le bot se met ensuite en pause pour ce contact (24 h) et le gérant est prévenu.">
          {vf("text", node.data.text, { multiline: true, placeholder: TEXTS.handoff })}
        </Row>
      );

    case "commande":
      return (
        <Row
          label="Action dans PFlow Order"
          hint="Le bot interroge PFlow Order et envoie sa réponse au client, puis le flux continue. Pour l'annulation, mettez toujours une confirmation (boutons Oui / Non) avant ce bloc."
        >
          <select className={inputCls} value={node.data.action} onChange={(e) => set({ action: e.target.value as "suivi" | "annulable" | "annulation" }, "action")}>
            <option value="suivi">Suivi : où en est sa dernière commande</option>
            <option value="annulable">Vérifier qu&apos;une commande peut être annulée (sorties Oui / Non)</option>
            <option value="annulation">Annulation de sa dernière commande (remboursée si payée)</option>
          </select>
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
            <li key={k} className={i.level === "error" ? "font-semibold text-alerte" : "text-alerte"}>
              {i.level === "error" ? "⚠" : "•"} {i.message}
            </li>
          ))}
        </ul>
      )}

      <Fields node={node} set={set} />

      {node.type !== "trigger" && (
        <div className="flex gap-2 border-t border-rule pt-3">
          <button type="button" className="flex-1 rounded-full border border-line py-1.5 text-sm font-semibold hover:border-ink/30" onClick={onDuplicate}>
            Dupliquer
          </button>
          <button type="button" className="flex-1 rounded-full border border-coral/40 py-1.5 text-sm font-semibold text-alerte hover:bg-coral/10" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

