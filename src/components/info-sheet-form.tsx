"use client";

import { useState } from "react";
import { WEEKDAY_LABELS, type InfoSheet, type IsoWeekday, type TimeRange } from "@/engine";
import { errorText, getRepositories } from "@/data/browser";
import { Button, Card, Field, Input, Notice, Textarea } from "./ui";
import { LocalClock } from "./local-clock";

const DAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

function plagesOf(sheet: InfoSheet, jour: IsoWeekday): TimeRange[] {
  return sheet.horaires.filter((d) => d.jour === jour).flatMap((d) => d.plages);
}

function withPlages(sheet: InfoSheet, jour: IsoWeekday, plages: TimeRange[]): InfoSheet {
  const others = sheet.horaires.filter((d) => d.jour !== jour);
  const horaires = plages.length ? [...others, { jour, plages }] : others;
  return { ...sheet, horaires: horaires.sort((a, b) => a.jour - b.jour) };
}

export function InfoSheetForm({ clientId, timezone, initial }: { clientId: string; timezone: string; initial: InfoSheet }) {
  const [sheet, setSheet] = useState<InfoSheet>(initial);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  function change(next: InfoSheet) {
    setSheet(next);
    setDirty(true);
    setStatus(null);
  }

  function text<K extends keyof InfoSheet>(key: K) {
    return {
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
                        className="bg-transparent text-sm"
                        onChange={(e) => change(withPlages(sheet, jour, plages.map((p, j) => (j === i ? { ...p, de: e.target.value } : p))))}
                      />
                      <span className="text-muted">→</span>
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[jour]} fermeture`}
                        value={plage.a}
                        className="bg-transparent text-sm"
                        onChange={(e) => change(withPlages(sheet, jour, plages.map((p, j) => (j === i ? { ...p, a: e.target.value } : p))))}
                      />
                      <button
                        type="button"
                        className="ml-1 text-muted hover:text-coral"
                        aria-label="Supprimer la plage"
                        onClick={() => change(withPlages(sheet, jour, plages.filter((_, j) => j !== i)))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="ml-auto text-sm font-semibold text-blue hover:underline"
                    onClick={() => change(withPlages(sheet, jour, [...plages, plages.length ? { de: "18:00", a: "22:00" } : { de: "11:30", a: "14:30" }]))}
                  >
                    + plage
                  </button>
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
          <Field label="Adresse">
            <Input placeholder="12 rue Frébault, Pointe-à-Pitre" {...text("adresse")} />
          </Field>
          <fieldset>
            <legend className="text-sm font-semibold">Service</legend>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-pink" checked={sheet.livraison ?? false} onChange={(e) => change({ ...sheet, livraison: e.target.checked })} />
                Livraison
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-pink" checked={sheet.retrait ?? false} onChange={(e) => change({ ...sheet, retrait: e.target.checked })} />
                Retrait sur place
              </label>
            </div>
          </fieldset>
          <Field label="Zones de livraison">
            <Textarea placeholder="Le Gosier, Pointe-à-Pitre… frais, minimum de commande" {...text("zonesLivraison")} />
          </Field>
          <Field label="Points de vente">
            <Textarea placeholder="Restaurant, food truck le samedi au marché…" {...text("pointsDeVente")} />
          </Field>
          <Field label="Résumé de la carte" hint="Les grandes familles de plats. Les prix restent sur le mini-site de commande.">
            <Textarea placeholder="Tacos, burritos, bowls, menu enfant…" {...text("resumeCarte")} />
          </Field>
          <Field label="Règles spéciales">
            <Textarea placeholder="L'agneau n'est dispo que le week-end…" {...text("reglesSpeciales")} />
          </Field>
        </div>

        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}
