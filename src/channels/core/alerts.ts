/**
 * Alertes au gérant (ou à Jules pour le numéro PFlow Démo) : « un client attend une réponse ».
 *
 * Elles partent du numéro du canal vers bot_canaux.tel_alerte. Un message LIBRE n'est accepté par Meta que si le
 * destinataire a écrit à ce numéro dans les 24 dernières heures ; en production, ce n'est presque jamais le cas.
 * Donc, dans l'ordre :
 * 1. message libre, seulement si la fenêtre de 24 h du destinataire est ouverte (il a écrit au canal récemment) ;
 * 2. sinon (ou s'il échoue) : MODÈLE approuvé par Meta, catégorie « utilitaire » (WHATSAPP_ALERTE_MODELE,
 *    WHATSAPP_ALERTE_LANGUE ; voir docs/etape-c/alertes-jules.md) ;
 * 3. si WhatsApp échoue (ou n'est pas configuré) : E-MAIL de secours (Resend : RESEND_API_KEY, ALERTE_EMAIL,
 *    ALERTE_EMAIL_FROM).
 * Le résultat (voie et erreurs) est gardé avec le transfert et affiché sur la page État.
 */
import type { AlertVoie, Canal, ChannelSender, ChannelStore } from "./types";
import { sendOptions } from "./send-options";

/** Marge sur la fenêtre de 24 h de Meta (horloges, délais d'envoi). */
const WINDOW_MS = 24 * 3600_000 - 10 * 60_000;

export interface AlertConfig {
  /** Modèle approuvé (nom exact chez Meta) et sa langue. */
  template?: { name: string; language: string };
  /**
   * E-mail de secours (Resend). Sans domaine vérifié chez Resend : expéditeur par défaut onboarding@resend.dev, qui
   * n'envoie QU'À l'adresse du compte Resend (ici jules.pauwels2@gmail.com = ALERTE_EMAIL) ; aucun domaine supposé.
   */
  email?: { apiKey: string; to: string; from: string };
  fetch?: typeof fetch;
}

export function alertConfigFromEnv(env: (name: string) => string): AlertConfig {
  const name = env("WHATSAPP_ALERTE_MODELE");
  const apiKey = env("RESEND_API_KEY");
  const to = env("ALERTE_EMAIL");
  return {
    ...(name ? { template: { name, language: env("WHATSAPP_ALERTE_LANGUE") || "fr" } } : {}),
    ...(apiKey && to ? { email: { apiKey, to, from: env("ALERTE_EMAIL_FROM") || "PFlow Bots <onboarding@resend.dev>" } } : {}),
  };
}

export interface AlertInput {
  canal: Canal;
  /** Motif court : « Je veux le mien », « Parler à Jules », « Question pendant la démo »… */
  motif: string;
  /** Nom de profil et numéro du client. */
  contactName?: string;
  contactId: string;
  /** Dernier message du client (extrait). */
  extrait?: string;
}

export interface AlertResult {
  voie: AlertVoie;
  erreurs: string[];
}

/** Un paramètre de modèle : une ligne (Meta refuse retours à la ligne, tabulations et plus de 4 espaces), borné. */
export function templateParam(value: string | undefined, max: number): string {
  const text = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const canalLabel = (canal: Canal) => canal.numeroAffiche?.trim() || (canal.role === "pflow" ? "PFlow Démo" : "votre numéro WhatsApp");
const who = (input: AlertInput) => (input.contactName ? `${input.contactName} (+${input.contactId})` : `+${input.contactId}`);

/** Le texte du message libre et de l'e-mail. */
export function alertText(input: AlertInput): string {
  const extrait = input.extrait?.trim() ? `\nDernier message : « ${input.extrait.trim().slice(0, 300)} »` : "";
  return `🔔 PFlow Bots : ${who(input)} attend une réponse sur ${canalLabel(input.canal)}.\nMotif : ${input.motif}${extrait}\nRépondez depuis la boîte de réception PFlow Bots.`;
}

/** Paramètres du modèle « alerte_conversation » : {{1}} client, {{2}} numéro du canal, {{3}} motif, {{4}} extrait. */
export function alertTemplateParams(input: AlertInput): string[] {
  return [templateParam(who(input), 80), templateParam(canalLabel(input.canal), 60), templateParam(input.motif, 60), templateParam(input.extrait, 200)];
}

/** La fenêtre de 24 h du destinataire de l'alerte est-elle ouverte sur ce canal ? */
async function windowOpen(store: ChannelStore, canal: Canal, to: string, now: Date): Promise<boolean> {
  const contact = (await store.listContacts(canal.id)).find((c) => c.waId === to);
  const last = contact?.state.lastInboundAt;
  return Boolean(last && now.getTime() - Date.parse(last) < WINDOW_MS);
}

async function sendEmail(config: NonNullable<AlertConfig["email"]>, input: AlertInput, doFetch: typeof fetch): Promise<void> {
  const response = await doFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject: `🔔 PFlow Bots : ${input.motif} (${input.contactName || `+${input.contactId}`})`,
      text: alertText(input),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Sans domaine vérifié, Resend n'envoie depuis onboarding@resend.dev qu'à l'adresse du compte Resend (sinon 403).
    const hint = response.status === 403 ? " — sans domaine vérifié, ALERTE_EMAIL doit être l'adresse du compte Resend" : "";
    throw new Error(`e-mail refusé (${response.status}) ${body.slice(0, 160)}${hint}`);
  }
}

const short = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Envoie l'alerte par la première voie qui marche. Ne lève jamais d'erreur. */
export async function sendAlert(deps: { store: ChannelStore; graph: ChannelSender; config?: AlertConfig; now: Date }, input: AlertInput): Promise<AlertResult> {
  const { canal } = input;
  const config = deps.config ?? {};
  const erreurs: string[] = [];
  const to = canal.telAlerte;
  if (to) {
    if (await windowOpen(deps.store, canal, to, deps.now)) {
      try {
        await deps.graph.send(canal.accountId, to, { kind: "text", text: alertText(input) }, sendOptions(canal));
        return { voie: "texte", erreurs };
      } catch (error) {
        erreurs.push(`message libre : ${short(error)}`);
      }
    }
    if (config.template && deps.graph.sendTemplate) {
      try {
        await deps.graph.sendTemplate(canal.accountId, to, { ...config.template, bodyParams: alertTemplateParams(input) }, sendOptions(canal));
        return { voie: "modele", erreurs };
      } catch (error) {
        erreurs.push(`modèle : ${short(error)}`);
      }
    } else {
      erreurs.push(config.template ? "modèle : envoi de modèles indisponible sur cette plateforme" : "modèle : WHATSAPP_ALERTE_MODELE non défini (fenêtre de 24 h fermée)");
    }
  } else {
    erreurs.push("WhatsApp : pas de numéro d'alerte (tel_alerte) sur ce canal");
  }
  if (config.email) {
    try {
      await sendEmail(config.email, input, config.fetch ?? fetch);
      return { voie: "email", erreurs };
    } catch (error) {
      erreurs.push(`e-mail : ${short(error)}`);
    }
  } else {
    erreurs.push("e-mail : RESEND_API_KEY ou ALERTE_EMAIL non défini");
  }
  return { voie: "aucune", erreurs };
}
