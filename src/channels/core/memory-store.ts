/** Stockage du canal en mémoire : tests et démo locale (jamais en production). */
import type { Session } from "@/engine";
import type { Canal, ChannelContact, ChannelStore, PushSubscriptionRecord, StoredMessage, Transfert } from "./types";
import type { DemoKnowledge } from "@/demos/demo-knowledge";

export function createMemoryChannelStore(canaux: Canal[] = [], options: { now?: () => Date; newId?: () => string } = {}): ChannelStore & {
  addCanal(canal: Canal): void;
  events: Map<string, { charge: unknown; error?: string; done: boolean; at: string; source: string; key: string }>;
} {
  const now = () => (options.now ? options.now() : new Date()).toISOString();
  let n = 0;
  const newId = options.newId ?? (() => `m${Date.now().toString(36)}${(n++).toString(36)}`);
  const canalList = [...canaux];
  const contacts = new Map<string, ChannelContact>();
  const sessions = new Map<string, { session: Session; version: number }>();
  const messages: StoredMessage[] = [];
  const transferts: Transfert[] = [];
  const pushSubscriptions = new Map<string, PushSubscriptionRecord>();
  let demoKnowledge: DemoKnowledge | null = null;
  const events = new Map<string, { charge: unknown; error?: string; done: boolean; at: string; source: string; key: string }>();
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    events,
    addCanal(canal) {
      canalList.push(canal);
    },
    async claimEvent(source, key, charge) {
      const k = `${source}:${key}`;
      if (events.has(k)) return false;
      events.set(k, { charge, done: false, at: now(), source, key });
      return true;
    },
    async finishEvent(source, key, error) {
      const e = events.get(`${source}:${key}`);
      if (e) Object.assign(e, { done: true, error });
    },
    async canalByAccount(plateforme, accountId) {
      return clone(canalList.find((c) => c.plateforme === plateforme && c.accountId === accountId) ?? null);
    },
    async recentEvents(limit = 20) {
      return [...events.values()]
        .slice(-limit)
        .reverse()
        .map((e) => ({ source: e.source as "whatsapp", key: e.key, at: e.at, ...(e.error ? { error: e.error } : {}) }));
    },
    async purgeOlderThan({ conversations, evenements }) {
      const before = (at: string | undefined, limit: Date) => Boolean(at) && Date.parse(at!) < limit.getTime();
      const drop = <T>(list: T[], old: (item: T) => boolean) => {
        const keep = list.filter((item) => !old(item));
        const removed = list.length - keep.length;
        list.splice(0, list.length, ...keep);
        return removed;
      };
      let sessionsRemoved = 0;
      for (const [id, s] of sessions) {
        if (!before(s.session.expiresAt, conversations)) continue;
        sessions.delete(id);
        sessionsRemoved++;
      }
      let eventsRemoved = 0;
      for (const [k, e] of events) {
        if (!before(e.at, evenements)) continue;
        events.delete(k);
        eventsRemoved++;
      }
      return {
        messages: drop(messages, (m) => before(m.at, conversations)),
        transferts: drop(transferts, (t) => before(t.at, conversations)),
        sessions: sessionsRemoved,
        appelsIa: 0,
        evenements: eventsRemoved,
      };
    },
    async listCanaux() {
      return clone(canalList);
    },
    async setCanalEtat(canalId, etat) {
      const canal = canalList.find((c) => c.id === canalId);
      if (!canal) throw new Error("Canal introuvable");
      canal.etat = etat;
    },
    async getOrCreateContact(canalId, waId, profileName) {
      let contact = [...contacts.values()].find((c) => c.canalId === canalId && c.waId === waId);
      if (!contact) {
        contact = {
          id: newId(),
          canalId,
          waId,
          state: { id: waId, profileName, pause: null, aiUsage: { day: "", calls: 0 } },
          stopOptions: false,
          updatedAt: now(),
        };
        contacts.set(contact.id, contact);
      } else if (profileName && contact.state.profileName !== profileName) {
        contact.state.profileName = profileName;
      }
      return clone(contact);
    },
    async getContact(contactId) {
      return clone(contacts.get(contactId) ?? null);
    },
    async saveContact(contact) {
      contacts.set(contact.id, { ...clone(contact), updatedAt: now() });
    },
    async getSession(contactId) {
      return clone(sessions.get(contactId) ?? null);
    },
    async saveSession(contactId, session, expectedVersion) {
      const current = sessions.get(contactId);
      if ((current?.version ?? null) !== expectedVersion) return false;
      if (!session) sessions.delete(contactId);
      else sessions.set(contactId, { session: clone(session), version: (current?.version ?? 0) + 1 });
      return true;
    },
    async addMessage(message) {
      const stored: StoredMessage = { ...clone(message), id: newId(), at: message.at ?? now() };
      messages.push(stored);
      return clone(stored);
    },
    async updateMessageStatus(wamid, statut, erreur) {
      const m = messages.find((x) => x.wamid === wamid);
      if (m) Object.assign(m, { statut, ...(erreur ? { erreur } : {}) });
    },
    async addTransfert(t) {
      const stored: Transfert = { gerantPrevenu: false, ...clone(t), id: newId(), at: now() };
      transferts.push(stored);
      return clone(stored);
    },
    async listContacts(canalId) {
      return clone([...contacts.values()].filter((c) => c.canalId === canalId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async listMessages(contactId, limit = 200) {
      return clone(messages.filter((m) => m.contactId === contactId).slice(-limit));
    },
    async listTransferts(canalId) {
      return clone(transferts.filter((t) => t.canalId === canalId).reverse());
    },
    async resolveTransferts(contactId) {
      for (const t of transferts) if (t.contactId === contactId && !t.resoluLe) t.resoluLe = now();
    },
    async savePushSubscription(subscription) {
      const previous = pushSubscriptions.get(subscription.endpoint);
      pushSubscriptions.set(subscription.endpoint, { creeLe: previous?.creeLe ?? now(), ...clone(subscription) });
    },
    async listPushSubscriptions(userId) {
      return clone([...pushSubscriptions.values()].filter((s) => !userId || s.userId === userId));
    },
    async deletePushSubscription(endpoint) {
      pushSubscriptions.delete(endpoint);
    },
    async getDemoKnowledge() {
      return demoKnowledge ? clone(demoKnowledge) : null;
    },
    async saveDemoKnowledge(k) {
      demoKnowledge = { ...clone(k), majLe: now() };
    },
  };
}
