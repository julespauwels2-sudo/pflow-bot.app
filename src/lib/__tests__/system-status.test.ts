import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/etat/route";
import { getChannelsRuntime } from "@/channels/core/runtime";

const SECRETS = {
  ANTHROPIC_API_KEY: "sk-ant-valeur-secrete-1",
  WHATSAPP_TOKEN: "EAAG-valeur-secrete-2",
  WHATSAPP_APP_SECRET: "valeur-secrete-3",
  WHATSAPP_VERIFY_TOKEN: "valeur-secrete-4",
  TRANSCRIPTION_PROVIDER: "mistral",
  TRANSCRIPTION_API_KEY: "valeur-secrete-5",
  CHANNELS_STORE: "memory",
};
const saved = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("/api/etat", () => {
  it("détecte les clés sans jamais renvoyer leur valeur", async () => {
    Object.assign(process.env, SECRETS);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const response = await GET(new Request("http://localhost/api/etat"));
    expect(response.status).toBe(200);
    const raw = await response.text();
    for (const [name, value] of Object.entries(SECRETS)) {
      if (name === "TRANSCRIPTION_PROVIDER" || name === "CHANNELS_STORE") continue;
      expect(raw).not.toContain(value);
    }
    const body = JSON.parse(raw);
    expect(body.cles.find((k: { name: string }) => k.name === "ANTHROPIC_API_KEY").present).toBe(true);
    expect(body.cles.find((k: { name: string }) => k.name === "INSTAGRAM_TOKEN").present).toBe(false);
    expect(body.canaux.find((c: { plateforme: string }) => c.plateforme === "whatsapp").configure).toBe(true);
    expect(body.canaux.find((c: { plateforme: string }) => c.plateforme === "instagram").missing).toContain("INSTAGRAM_TOKEN");
    expect(body.services.transcription).toEqual({ active: true, service: "mistral" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("alertes : voie push ou aucune, encore ouvertes ; état des notifications (clés, appareils) pour le bandeau rouge", async () => {
    Object.assign(process.env, SECRETS);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { store } = await getChannelsRuntime();
    const contact = await store.getOrCreateContact("canal-pflow", "590690111111", "Marc");
    await store.addTransfert({ canalId: "canal-pflow", contactId: contact.id, source: "bloc", dernierMessage: "Je veux le mien", gerantPrevenu: false, alertePush: "aucun_abonnement", alerteErreur: "push : aucun appareil abonné" });
    await store.addTransfert({ canalId: "canal-pflow", contactId: contact.id, source: "bloc", gerantPrevenu: true, alertePush: "envoyee" });
    await store.addTransfert({ canalId: "canal-pflow", contactId: contact.id, source: "bloc", gerantPrevenu: true, alerteVoie: "modele" });
    const body = await (await GET(new Request("http://localhost/api/etat"))).json();
    expect(body.push).toEqual({ configure: false, appareils: 0 });
    const voies = body.alertes.map((a: { voie: string; push?: string; prevenu: boolean; ouverte: boolean }) => [a.voie, a.push ?? null, a.prevenu, a.ouverte]);
    expect(voies).toEqual(expect.arrayContaining([["aucune", "aucun_abonnement", false, true], ["push", "envoyee", true, true], ["modele", null, true, true]]));
  });

  it("refusée sans connexion quand Supabase est configuré", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-publique";
    const response = await GET(new Request("http://localhost/api/etat"));
    expect(response.status).toBe(401);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
});
