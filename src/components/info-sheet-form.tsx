"use client";

import { useState } from "react";
import {
  WEEKDAY_LABELS,
  infoSheetVariables,
  upcomingRounds,
  type DeliveryRound,
  type InfoSheet,
  type IsoWeekday,
  type TimeRange,
} from "@/engine";
import { BUILTIN_VARIABLES } from "@/editor/variables";
import { errorText, getRepositories } from "@/data/browser";
import { Button, Card, Field, Input, Notice, Textarea } from "./ui";
import { LocalClock, useCurrentMinute } from "./local-clock";

const DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

function plagesOf(sheet: InfoSheet, jour: IsoWeekday): TimeRange[] {
  return sheet.horaires.filter((d) => d.jour === jour).flatMap((d) => d.plages);
}

function withPlages(sheet: InfoSheet, jour: IsoWeekday, plages: TimeRange[]): InfoSheet {
  const others = sheet.horaires.filter((d) => d.jour !== jour);
  const horaires = plages.length ? [...others, { jour, plages }] : others;
  return { ...sheet, horaires: horaires.sort((a, b) => a.jour - b.jour) };
}

export function InfoSheetForm({
  clientId,
  timezone,
  initial,
  onSaved,
  locked = [],
}: {
  clientId: string;
  timezone: string;
  initial: InfoSheet;
  /** Champs lus dans le CRM : affichés, non modifiables ici. */
  locked?: (keyof InfoSheet)[];
  /** Appelé après l'enregistrement (ex. pour recalculer la liste de contrôle du bot). */
  onSaved?: () => void;
}) {
  const [sheet, setSheet] = useState<InfoSheet>(initial);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  function change(next: InfoSheet) {
    setSheet(next);
    setDirty(true);
    setStatus(null);
  }

  const isLocked = (key: keyof InfoSheet) => locked.includes(key);

  function text<K extends keyof InfoSheet>(key: K) {
    return {
      disabled: isLocked(key),
      value: (sheet[key] as string | undefined) ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change({ ...sheet, [key]: e.target.value || undefined }),
    };
  }

  async function save() {
    try {
      const saved = await getRepositories().infoSheets.save(clientId, sheet);
      setSheet(saved);
      setDirty(false);
      setStatus({ tone: "success", text: "Fiche d'infos enregistrée." });
      onSaved?.();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    }
  }

  return (
    <Card
      title="Fiche d'infos"
      description="Ce que l'IA sait du resto. Elle n'invente jamais un prix, un plat ou une disponibilité absents d'ici."
      actions={
        <Button onClick={save} disabled={!dirty}>
          Enregistrer
        </Button>
      }
    >
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold">
            Horaires <span className="font-normal text-muted">(heure locale du resto : <LocalClock timezone={timezone} />)</span>
            {isLocked("horaires") && <CrmTag />}
          </h3>
          <ul className="mt-2 divide-y divide-rule rounded-2xl border border-rule">
            {DAYS.map((jour) => {
              const plages = plagesOf(sheet, jour);
              return (
                <li key={jour} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="w-24 text-sm font-semibold capitalize">{WEEKDAY_LABELS[jour]}</span>
                  {plages.length === 0 && <span className="text-sm text-muted">Fermé</span>}
                  {plages.map((plage, i) => (
                    <span key={i} className="flex items-center gap-1 rounded-xl bg-page px-2 py-1">
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[jour]} ouverture`}
                        value={plage.de}
                        disabled={isLocked("horaires")}
                        className="bg-transparent text-sm"
                        onChange={(e) => change(withPlages(sheet, jour, plages.map((p, j) => (j === i ? { ...p, de: e.target.value } : p))))}
                      />
                      <span className="text-muted">→</span>
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[jour]} fermeture`}
                        value={plage.a}
                        disabled={isLocked("horaires")}
                        className="bg-transparent text-sm"
                        onChange={(e) => change(withPlages(sheet, jour, plages.map((p, j) => (j === i ? { ...p, a: e.target.value } : p))))}
                      />
                      {!isLocked("horaires") && (
                      <button
                        type="button"
                        className="ml-1 text-muted hover:text-coral"
                        aria-label="Supprimer la plage"
                        onClick={() => change(withPlages(sheet, jour, plages.filter((_, j) => j !== i)))}
                      >
                        ✕
                      </button>
                      )}
                    </span>
                  ))}
                  {!isLocked("horaires") && (
                  <button
                    type="button"
                    className="ml-auto text-sm font-semibold text-blue hover:underline"
                    onClick={() => change(withPlages(sheet, jour, [...plages, plages.length ? { de: "18:00", a: "22:00" } : { de: "11:30", a: "14:30" }]))}
                  >
                    + plage
                  </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-muted">Une plage comme 18:00 → 02:00 passe minuit (ouvert jusqu&apos;à 2 h le lendemain).</p>
          <Field label="Précisions sur les horaires" className="mt-3">
            <Input placeholder="Fermé le 25 décembre, horaires réduits en août…" {...text("horairesNote")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isLocked("adresse") ? "Adresse (CRM)" : "Adresse"}>
            <Input placeholder="12 rue Frébault, Pointe-à-Pitre" {...text("adresse")} />
          </Field>
          <fieldset>
            <legend className="text-sm font-semibold">Service{(isLocked("livraison") || isLocked("retrait")) && <CrmTag />}</legend>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-pink" checked={sheet.livraison ?? false} disabled={isLocked("livraison")} onChange={(e) => change({ ...sheet, livraison: e.target.checked })} />
                Livraison
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-pink" checked={sheet.retrait ?? false} disabled={isLocked("retrait")} onChange={(e) => change({ ...sheet, retrait: e.target.checked })} />
                Retrait sur place
              </label>
            </div>
          </fieldset>
          <Field label="Moyens de paiement">
            <Input placeholder="Espèces ou carte bancaire au comptoir" {...text("modesPaiement")} />
          </Field>
          {sheet.livraison && (
            <div className="sm:col-span-2">
              <DeliveryEditor sheet={sheet} timezone={timezone} onChange={change} zonesLocked={isLocked("zonesLivraison")} />
            </div>
          )}
          <Field label="Points de vente">
            <Textarea placeholder="Restaurant, food truck le samedi au marché…" {...text("pointsDeVente")} />
          </Field>
          <Field
            label={isLocked("resumeCarte") ? "Carte (lue dans PFlow Order)" : "Carte (pour l'IA)"}
            hint={
              isLocked("resumeCarte")
                ? "Produits disponibles, prix, options et allergènes, lus dans PFlow Order. À modifier dans le dashboard."
                : "Colle la carte : produits, prix, descriptions, allergènes. C'est la seule source de l'IA sur les produits. Dès que le resto a des produits dans PFlow Order, la carte est lue là-bas."
            }
          >
            <Textarea rows={8} placeholder={"== Cookies ==\n• Cookies Nutella : 4 €\nCœur fondant au chocolat\nAllergènes : Gluten, Œufs, Lait"} {...text("resumeCarte")} />
          </Field>
          <Field label="Questions fréquentes (pour l'IA)" hint="Une question et sa réponse par ligne ou par paragraphe. Uniquement des faits sûrs.">
            <Textarea rows={4} placeholder={"Vous faites des box ? Oui : 6, 10 ou 15 cookies.\nVous livrez le dimanche ? Non."} {...text("faq")} />
          </Field>
          <Field label="Règles spéciales" hint="Lues par l'IA en priorité (ex. exceptions, produits du week-end).">
            <Textarea placeholder="L'agneau n'est dispo que le week-end…" {...text("reglesSpeciales")} />
          </Field>
        </div>

        <VariablesPreview sheet={sheet} timezone={timezone} />

        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}

const newRoundId = () => crypto.randomUUID();

function CrmTag() {
  return <span className="ml-2 rounded-full bg-blue/10 px-2 py-0.5 text-[11px] font-semibold text-blue">CRM</span>;
}

/** Livraison : zones fixes, ou tournées à des dates précises (planning). */
function DeliveryEditor({
  sheet,
  timezone,
  onChange,
  zonesLocked = false,
}: {
  sheet: InfoSheet;
  timezone: string;
  onChange: (s: InfoSheet) => void;
  zonesLocked?: boolean;
}) {
  const minute = useCurrentMinute();
  const mode = sheet.livraisonMode ?? "zones";
  const rounds = sheet.tournees ?? [];
  const upcoming = minute === null ? null : new Set(upcomingRounds(rounds, new Date(minute * 60_000), timezone).map((r) => r.id));
  const past = upcoming ? rounds.filter((r) => !upcoming.has(r.id)) : [];
  const setRounds = (tournees: DeliveryRound[]) => onChange({ ...sheet, tournees });
  const updateRound = (id: string, patch: Partial<DeliveryRound>) => setRounds(rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <fieldset className="rounded-2xl border border-rule p-3">
      <legend className="px-1 text-sm font-semibold">Livraison</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            ["zones", "Zones fixes"],
            ["planning", "Sur planning (tournées à des dates précises)"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="livraisonMode" className="accent-pink" checked={mode === value} onChange={() => onChange({ ...sheet, livraisonMode: value })} />
            {label}
          </label>
        ))}
      </div>

      {mode === "zones" ? (
        <Field
          label={zonesLocked ? "Zones de livraison (CRM)" : "Zones de livraison"}
          hint={zonesLocked ? "Zones, frais et minimums lus dans le CRM." : undefined}
          className="mt-3"
        >
          <Textarea
            disabled={zonesLocked}
            placeholder="Jarry et Dothémare (livraison offerte)…"
            value={sheet.zonesLivraison ?? ""}
            onChange={(e) => onChange({ ...sheet, zonesLivraison: e.target.value || undefined })}
          />
        </Field>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">
            L&apos;IA ne propose que les tournées à venir de cette liste : jamais une autre date, jamais une tournée passée. Heures facultatives, dans
            le fuseau du client.
          </p>
          {rounds.length === 0 && <p className="text-sm text-muted">Aucune tournée.</p>}
          <ul className="space-y-2">
            {rounds.map((r) => {
              const isPast = upcoming !== null && !upcoming.has(r.id);
              return (
                <li key={r.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-line p-2 ${isPast ? "opacity-50" : ""}`}>
                  <input type="date" aria-label="Date de la tournée" className="rounded-lg border border-line px-2 py-1 text-sm" value={r.date} onChange={(e) => updateRound(r.id, { date: e.target.value })} />
                  <input type="time" aria-label="Début" className="rounded-lg border border-line px-2 py-1 text-sm" value={r.de ?? ""} onChange={(e) => updateRound(r.id, { de: e.target.value || undefined })} />
                  <span className="text-muted">→</span>
                  <input type="time" aria-label="Fin" className="rounded-lg border border-line px-2 py-1 text-sm" value={r.a ?? ""} onChange={(e) => updateRound(r.id, { a: e.target.value || undefined })} />
                  <input
                    aria-label="Zone ou entreprises desservies"
                    placeholder="Jarry — Orange, EDF…"
                    className="min-w-40 flex-1 rounded-lg border border-line px-2 py-1 text-sm"
                    value={r.lieux}
                    onChange={(e) => updateRound(r.id, { lieux: e.target.value })}
                  />
                  {isPast && <span className="text-xs font-semibold text-muted">passée</span>}
                  <button type="button" aria-label="Supprimer la tournée" className="px-1 text-coral" onClick={() => setRounds(rounds.filter((x) => x.id !== r.id))}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const today = minute === null ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(minute * 60_000));
                setRounds([...rounds, { id: newRoundId(), date: today, lieux: "" }]);
              }}
            >
              + Ajouter une tournée
            </Button>
            {past.length > 0 && (
              <Button variant="ghost" onClick={() => setRounds(rounds.filter((r) => upcoming?.has(r.id)))}>
                Retirer les {past.length} tournée{past.length > 1 ? "s" : ""} passée{past.length > 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

const INFO_VARIABLE_LABELS = new Map(BUILTIN_VARIABLES.map((v) => [v.name, v.label]));

/** Ce que donnent les variables {{...}} avec cette fiche, maintenant, au fuseau du client. */
function VariablesPreview({ sheet, timezone }: { sheet: InfoSheet; timezone: string }) {
  const minute = useCurrentMinute();
  if (minute === null) return null;
  const vars = infoSheetVariables(sheet, new Date(minute * 60_000), timezone);
  return (
    <details className="rounded-2xl border border-rule bg-page p-3">
      <summary className="cursor-pointer text-sm font-semibold">Aperçu des variables utilisables dans les messages</summary>
      <dl className="mt-3 space-y-3">
        {Object.entries(vars).map(([name, value]) => (
          <div key={name}>
            <dt className="text-xs">
              <span className="font-mono font-semibold text-pink">{`{{${name}}}`}</span>
              <span className="text-muted"> · {INFO_VARIABLE_LABELS.get(name)}</span>
            </dt>
            <dd className="mt-1 rounded-xl bg-white px-3 py-2 text-sm whitespace-pre-wrap">{value || <span className="text-muted italic">(vide)</span>}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
