/**
 * Notifications push, réservé aux administrateurs du bot :
 * - GET : clé publique VAPID (pas un secret : le navigateur en a besoin pour s'abonner) et appareils abonnés du compte ;
 * - POST : enregistre l'abonnement de cet appareil (après le geste « Activer les notifications ») ;
 * - DELETE : le retire.
 * Les clés privées restent dans les variables Vercel ; rien n'est renvoyé d'autre que la clé publique.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { pushConfigFromEnv } from "@/channels/core/push";
import { MAX_PUSH_DEVICES, pushAccess } from "@/lib/push-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = (name: string) => process.env[name]?.trim() || "";
const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
const subscriptionSchema = z.object({
  subscription: z.object({
    // Les services push (Apple, Google, Mozilla, Microsoft) sont toujours en https.
    endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "adresse du service push invalide"),
    keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(8).max(64) }),
  }),
  appareil: z.string().trim().max(80).optional(),
});
const deleteSchema = z.object({ endpoint: z.string().max(1000) });

export async function GET(request: Request) {
  const access = await pushAccess(request, "push", 60);
  if (!access.ok) return access.response;
  const config = pushConfigFromEnv(env);
  const appareils = await access.store.listPushSubscriptions(access.userId).catch(() => []);
  return NextResponse.json(
    {
      configure: Boolean(config),
      publicKey: config?.publicKey ?? null,
      // L'adresse du service push n'est renvoyée que pour reconnaître CET appareil (comparaison côté page).
      appareils: appareils.map((s) => ({
        endpoint: s.endpoint,
        appareil: s.appareil ?? null,
        creeLe: s.creeLe ?? null,
        dernierEnvoiLe: s.dernierEnvoiLe ?? null,
        dernierEchecLe: s.dernierEchecLe ?? null,
        dernierEchec: s.dernierEchec ?? null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const access = await pushAccess(request, "push", 20);
  if (!access.ok) return access.response;
  if (!pushConfigFromEnv(env)) return NextResponse.json({ error: "Clés VAPID absentes : ajoute VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans Vercel." }, { status: 503 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Abonnement invalide." }, { status: 400 });
  const { subscription, appareil } = parsed.data;
  const existing = await access.store.listPushSubscriptions(access.userId);
  const other = (await access.store.listPushSubscriptions()).find((s) => s.endpoint === subscription.endpoint && s.userId !== access.userId);
  if (other) return NextResponse.json({ error: "Cet appareil est déjà abonné sur un autre compte." }, { status: 409 });
  if (!existing.some((s) => s.endpoint === subscription.endpoint) && existing.length >= MAX_PUSH_DEVICES) {
    return NextResponse.json({ error: `${MAX_PUSH_DEVICES} appareils au plus : retire un ancien appareil sur la page État.` }, { status: 409 });
  }
  await access.store.savePushSubscription({
    userId: access.userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    ...(appareil ? { appareil } : {}),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const access = await pushAccess(request, "push", 20);
  if (!access.ok) return access.response;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Appareil invalide." }, { status: 400 });
  // Seulement un appareil de CE compte.
  const mine = (await access.store.listPushSubscriptions(access.userId)).some((s) => s.endpoint === parsed.data.endpoint);
  if (mine) await access.store.deletePushSubscription(parsed.data.endpoint);
  return NextResponse.json({ ok: true, retire: mine });
}
