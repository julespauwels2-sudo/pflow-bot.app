/**
 * Stockage du canal dans les tables de la migration C (bot_canaux, bot_contacts, bot_sessions,
 * bot_messages, bot_transferts, bot_webhook_evenements). Ces tables n'existent pas encore : ce code
 * ne sert qu'une fois la migration C validée et appliquée. Toutes les écritures passent par
 * l'adaptateur qui refuse les tables hors bot_.
 */
import type { Session } from "@/engine";
import type { Db, Row } from "@/data/supabase/db";
import type { Canal, ChannelContact, ChannelStore, PushSubscriptionRecord, StoredMessage, Transfert } from "./types";
import { DEMO_KNOWLEDGE_ID } from "@/demos/demo-knowledge";

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : undefined);
const eq = (column: string, value: string) => ({ in: { column, values: [value] } });

function rowToCanal(r: Row): Canal {
  return {
    id: String(r.id),
    restaurantId: r.restaurant_id ? String(r.restaurant_id) : "",
    role: r.role === "pflow" ? "pflow" : "resto",
    plateforme: r.plateforme === "instagram" ? "instagram" : "whatsapp",
    accountId: String(r.compte_id),
    ...(r.waba_id ? { wabaId: String(r.waba_id) } : {}),
    // Colonne ajoutée par la migration 20261107010000 (absente avant : le champ est alors omis des envois).
    ...(r.messaging_account_id ? { messagingAccountId: String(r.messaging_account_id) } : {}),
    ...(r.numero_affiche ? { numeroAffiche: String(r.numero_affiche) } : {}),
    triggerMode: r.mode_declenchement === "toujours" ? "toujours" : "mots_cles_uniquement",
    coexistence: Boolean(r.coexistence),
    echoPauseHours: Number(r.pause_echo_heures ?? 12),
    handoffPauseHours: Number(r.pause_transfert_heures ?? 24),
    sessionMinutes: Number(r.session_minutes ?? 30),
    ...(r.tel_alerte ? { telAlerte: String(r.tel_alerte) } : {}),
    etat: r.etat === "actif" || r.etat === "coupe" ? r.etat : "test",
    testNumeros: Array.isArray(r.test_numeros) ? r.test_numeros.map(String) : [],
  };
}

function rowToContact(r: Row): ChannelContact {
  return {
    id: String(r.id),
    canalId: String(r.canal_id),
    waId: String(r.identifiant),
    state: {
      id: String(r.identifiant),
      ...(r.profil_nom ? { profileName: String(r.profil_nom) } : {}),
      pause: r.pause_raison ? { reason: r.pause_raison as "transfert_humain" | "echo_gerant" | "manuel", until: iso(r.pause_jusqu_a) ?? null } : null,
      ...(r.dernier_entrant_le ? { lastInboundAt: iso(r.dernier_entrant_le) } : {}),
      aiUsage: { day: r.ia_jour ? String(r.ia_jour).slice(0, 10) : "", calls: Number(r.ia_appels ?? 0) },
    },
    stopOptions: Boolean(r.stop_options),
    updatedAt: iso(r.maj_le) ?? new Date().toISOString(),
    ...(r.demo ? { demo: r.demo as ChannelContact["demo"] } : {}),
  };
}

function contactToRow(c: ChannelContact): Row {
  return {
    id: c.id,
    canal_id: c.canalId,
    identifiant: c.waId,
    profil_nom: c.state.profileName ?? null,
    pause_raison: c.state.pause?.reason ?? null,
    pause_jusqu_a: c.state.pause?.until ?? null,
    dernier_entrant_le: c.state.lastInboundAt ?? null,
    ia_jour: c.state.aiUsage.day || null,
    ia_appels: c.state.aiUsage.calls,
    stop_options: c.stopOptions,
    demo: c.demo ?? null,
    maj_le: new Date().toISOString(),
  };
}

function rowToMessage(r: Row): StoredMessage {
  return {
    id: String(r.id),
    canalId: String(r.canal_id),
    contactId: String(r.contact_id),
    sens: r.sens as StoredMessage["sens"],
    ...(r.auteur ? { auteur: r.auteur as "bot" | "humain" } : {}),
    ...(r.wamid ? { wamid: String(r.wamid) } : {}),
    type: String(r.type),
    contenu: r.contenu,
    ...(r.statut ? { statut: r.statut as StoredMessage["statut"] } : {}),
    ...(r.erreur ? { erreur: String(r.erreur) } : {}),
    at: iso(r.cree_le)!,
  };
}

function rowToPush(r: Row): PushSubscriptionRecord {
  return {
    userId: String(r.user_id),
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
    ...(r.appareil ? { appareil: String(r.appareil) } : {}),
    ...(r.cree_le ? { creeLe: iso(r.cree_le) } : {}),
    ...(r.dernier_envoi_le ? { dernierEnvoiLe: iso(r.dernier_envoi_le) } : {}),
    ...(r.dernier_echec_le ? { dernierEchecLe: iso(r.dernier_echec_le) } : {}),
    ...(r.dernier_echec ? { dernierEchec: String(r.dernier_echec) } : {}),
  };
}

function rowToTransfert(r: Row): Transfert {
  return {
    id: String(r.id),
    canalId: String(r.canal_id),
    contactId: String(r.contact_id),
    source: r.source as Transfert["source"],
    ...(r.dernier_message ? { dernierMessage: String(r.dernier_message) } : {}),
    gerantPrevenu: Boolean(r.gerant_prevenu),
    ...(r.alerte_voie ? { alerteVoie: r.alerte_voie as Transfert["alerteVoie"] } : {}),
    ...(r.alerte_erreur ? { alerteErreur: String(r.alerte_erreur) } : {}),
    ...(r.alerte_push ? { alertePush: r.alerte_push as Transfert["alertePush"] } : {}),
    at: iso(r.cree_le)!,
    ...(r.vu_le ? { vuLe: iso(r.vu_le) } : {}),
    ...(r.resolu_le ? { resoluLe: iso(r.resolu_le) } : {}),
  };
}

export function createSupabaseChannelStore(db: Db, newId: () => string = () => crypto.randomUUID()): ChannelStore {
  return {
    async claimEvent(source, key, charge) {
      if (!db.insert) throw new Error("Insertion non disponible");
      const { conflict } = await db.insert("bot_webhook_evenements", { source, cle_unique: `${source}:${key}`, charge });
      return !conflict;
    },
    async finishEvent(source, key, error) {
      const [row] = await db.select("bot_webhook_evenements", "*", eq("cle_unique", `${source}:${key}`));
      if (row) await db.upsert("bot_webhook_evenements", [{ ...row, traite_le: new Date().toISOString(), erreur: error ?? null }], "id");
    },
    async canalByAccount(plateforme, accountId) {
      const rows = await db.select("bot_canaux", "*", eq("compte_id", accountId));
      const row = rows.find((r) => (r.plateforme ?? "whatsapp") === plateforme);
      return row ? rowToCanal(row) : null;
    },
    async recentEvents(limit = 20) {
      const rows = await db.select("bot_webhook_evenements", "source, cle_unique, recu_le, erreur", { order: { column: "recu_le", ascending: false }, limit });
      return rows.map((r) => ({
        source: r.source as "whatsapp",
        key: String(r.cle_unique),
        at: iso(r.recu_le)!,
        ...(r.erreur ? { error: String(r.erreur) } : {}),
      }));
    },
    async purgeOlderThan({ conversations, evenements }) {
      if (!db.removeOlderThan) throw new Error("Suppression par date non disponible");
      const c = conversations.toISOString();
      // Uniquement des tables bot_ (assertBotTable) ; aucune clé étrangère vers ces tables.
      return {
        messages: await db.removeOlderThan("bot_messages", "cree_le", c),
        transferts: await db.removeOlderThan("bot_transferts", "cree_le", c),
        sessions: await db.removeOlderThan("bot_sessions", "expire_le", c),
        appelsIa: await db.removeOlderThan("bot_appels_ia", "cree_le", c),
        evenements: await db.removeOlderThan("bot_webhook_evenements", "recu_le", evenements.toISOString()),
      };
    },
    async listCanaux() {
      return (await db.select("bot_canaux", "*")).map(rowToCanal);
    },
    async setCanalEtat(canalId, etat) {
      const [row] = await db.select("bot_canaux", "*", eq("id", canalId));
      if (!row) throw new Error("Canal introuvable");
      await db.upsert("bot_canaux", [{ ...row, etat, maj_le: new Date().toISOString() }], "id");
    },
    async getOrCreateContact(canalId, waId, profileName) {
      const existing = (await db.select("bot_contacts", "*", eq("canal_id", canalId))).find((r) => String(r.identifiant) === waId);
      if (existing) {
        const contact = rowToContact(existing);
        if (profileName && contact.state.profileName !== profileName) {
          contact.state.profileName = profileName;
          await db.upsert("bot_contacts", [contactToRow(contact)], "id");
        }
        return contact;
      }
      const contact: ChannelContact = {
        id: newId(),
        canalId,
        waId,
        state: { id: waId, profileName, pause: null, aiUsage: { day: "", calls: 0 } },
        stopOptions: false,
        updatedAt: new Date().toISOString(),
      };
      await db.upsert("bot_contacts", [contactToRow(contact)], "id");
      return contact;
    },
    async getContact(contactId) {
      const [row] = await db.select("bot_contacts", "*", eq("id", contactId));
      return row ? rowToContact(row) : null;
    },
    async saveContact(contact) {
      await db.upsert("bot_contacts", [contactToRow(contact)], "id");
    },
    async getSession(contactId) {
      const [r] = await db.select("bot_sessions", "*", eq("contact_id", contactId));
      if (!r) return null;
      return {
        version: Number(r.version),
        session: {
          flowId: String(r.flux_id),
          nodeId: String(r.bloc_id),
          vars: (r.variables as Record<string, string>) ?? {},
          retries: Number(r.essais ?? 0),
          startedAt: iso(r.debut_le)!,
          expiresAt: iso(r.expire_le)!,
          ...(r.ia_historique ? { aiHistory: r.ia_historique as Session["aiHistory"] } : {}),
        },
      };
    },
    async saveSession(contactId, session, expectedVersion) {
      // Verrou optimiste (simple) : on relit la version juste avant d'écrire.
      const [current] = await db.select("bot_sessions", "version", eq("contact_id", contactId));
      if ((current ? Number(current.version) : null) !== expectedVersion) return false;
      if (!session) {
        if (current) await db.remove("bot_sessions", "contact_id", [contactId]);
        return true;
      }
      await db.upsert(
        "bot_sessions",
        [
          {
            contact_id: contactId,
            flux_id: session.flowId,
            bloc_id: session.nodeId,
            variables: session.vars,
            essais: session.retries,
            ia_historique: session.aiHistory ?? null,
            debut_le: session.startedAt,
            expire_le: session.expiresAt,
            version: (expectedVersion ?? 0) + 1,
          },
        ],
        "contact_id",
      );
      return true;
    },
    async addMessage(m) {
      const row: Row = {
        id: newId(),
        canal_id: m.canalId,
        contact_id: m.contactId,
        sens: m.sens,
        auteur: m.auteur ?? null,
        wamid: m.wamid ?? null,
        type: m.type,
        contenu: m.contenu ?? {},
        statut: m.statut ?? null,
        erreur: m.erreur ?? null,
        cree_le: m.at ?? new Date().toISOString(),
      };
      await db.upsert("bot_messages", [row], "id");
      return rowToMessage(row);
    },
    async updateMessageStatus(wamid, statut, erreur) {
      const [row] = await db.select("bot_messages", "*", eq("wamid", wamid));
      if (row) await db.upsert("bot_messages", [{ ...row, statut, erreur: erreur ?? row.erreur ?? null, maj_le: new Date().toISOString() }], "id");
    },
    async addTransfert(t) {
      const row: Row = {
        id: newId(),
        canal_id: t.canalId,
        contact_id: t.contactId,
        source: t.source,
        dernier_message: t.dernierMessage ?? null,
        gerant_prevenu: t.gerantPrevenu ?? false,
        cree_le: new Date().toISOString(),
      };
      const alerte: Row = {
        ...(t.alerteVoie ? { alerte_voie: t.alerteVoie } : {}),
        ...(t.alerteErreur ? { alerte_erreur: t.alerteErreur.slice(0, 1000) } : {}),
        ...(t.alertePush ? { alerte_push: t.alertePush } : {}),
      };
      try {
        await db.upsert("bot_transferts", [{ ...row, ...alerte }], "id");
        return rowToTransfert({ ...row, ...alerte });
      } catch (error) {
        // Colonne pas encore créée (alerte_push : migration 20261110000000, non appliquée) : on réessaie sans elle,
        // puis sans aucune colonne d'alerte. Le transfert passe toujours.
        const message = error instanceof Error ? error.message : String(error);
        if (!Object.keys(alerte).length || !/alerte_(voie|erreur|push)/.test(message)) throw error;
        const { alerte_push: _push, ...withoutPush } = alerte;
        void _push;
        try {
          if (!("alerte_push" in alerte) || !/alerte_push/.test(message)) throw error;
          await db.upsert("bot_transferts", [{ ...row, ...withoutPush }], "id");
          return rowToTransfert({ ...row, ...withoutPush });
        } catch {
          await db.upsert("bot_transferts", [row], "id");
          return rowToTransfert(row);
        }
      }
    },
    async listContacts(canalId) {
      return (await db.select("bot_contacts", "*", { ...eq("canal_id", canalId), order: { column: "maj_le", ascending: false } })).map(rowToContact);
    },
    async listMessages(contactId, limit = 200) {
      const rows = await db.select("bot_messages", "*", { ...eq("contact_id", contactId), order: { column: "cree_le", ascending: false }, limit });
      return rows.map(rowToMessage).reverse();
    },
    async listTransferts(canalId) {
      return (await db.select("bot_transferts", "*", { ...eq("canal_id", canalId), order: { column: "cree_le", ascending: false }, limit: 200 })).map(rowToTransfert);
    },
    async resolveTransferts(contactId) {
      const rows = (await db.select("bot_transferts", "*", eq("contact_id", contactId))).filter((r) => !r.resolu_le);
      if (rows.length) await db.upsert("bot_transferts", rows.map((r) => ({ ...r, resolu_le: new Date().toISOString() })), "id");
    },
    async savePushSubscription(s) {
      await db.upsert(
        "bot_push_abonnements",
        [{
          user_id: s.userId,
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
          appareil: s.appareil ?? null,
          ...(s.dernierEnvoiLe ? { dernier_envoi_le: s.dernierEnvoiLe } : {}),
          ...(s.dernierEchecLe ? { dernier_echec_le: s.dernierEchecLe } : {}),
          ...(s.dernierEchec !== undefined ? { dernier_echec: s.dernierEchec || null } : {}),
        }],
        "endpoint",
      );
    },
    async listPushSubscriptions(userId) {
      return (await db.select("bot_push_abonnements", "*", userId ? eq("user_id", userId) : {})).map(rowToPush);
    },
    async deletePushSubscription(endpoint) {
      await db.remove("bot_push_abonnements", "endpoint", [endpoint]);
    },
    // Base de connaissances du bot PFlow Démo : une ligne de bot_fiches sous un identifiant fixe (hors CRM).
    async getDemoKnowledge() {
      const [row] = await db.select("bot_fiches", "donnees, maj_le", eq("restaurant_id", DEMO_KNOWLEDGE_ID));
      const d = (row?.donnees ?? null) as { faq?: unknown; reglesSpeciales?: unknown } | null;
      if (!d) return null;
      return { faq: typeof d.faq === "string" ? d.faq : "", regles: typeof d.reglesSpeciales === "string" ? d.reglesSpeciales : "", ...(row?.maj_le ? { majLe: String(row.maj_le) } : {}) };
    },
    async saveDemoKnowledge(k) {
      await db.upsert("bot_fiches", [{ restaurant_id: DEMO_KNOWLEDGE_ID, donnees: { faq: k.faq, reglesSpeciales: k.regles }, maj_le: new Date().toISOString() }], "restaurant_id");
    },
  };
}
