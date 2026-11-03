# PFlow Bots

Plateforme de chatbots WhatsApp des restos PFlow (`bots.pflow.fr`).
Application indépendante du CRM : une panne de l'un ne fait jamais tomber l'autre.

## Démarrer en local

```bash
npm install          # npm 11 recommandé (npx npm@11 install si npm 10 plante)
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Sans `BASIC_AUTH_PASSWORD`, l'accès est libre en local. En production, l'app refuse
tout (503) tant que le mot de passe n'est pas défini.

## Commandes

| Commande | Rôle |
|---|---|
| `npm test` | Tests unitaires (moteur, protection) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Build de production |

## Structure

```
src/engine/   Moteur pur : flux + session + message entrant → nouvel état + messages à envoyer.
              Aucune dépendance (ni Next, ni WhatsApp, ni base). Testé dans __tests__/.
src/lib/      Utilitaires serveur (protection provisoire par mot de passe).
src/proxy.ts  Protection de toutes les pages sauf /api/webhooks/.
src/app/      Interface Next.js (App Router).
```

À venir : `src/data/` (repositories localStorage puis Supabase), `src/components/editor`,
`src/channels/whatsapp` (webhook isolé, hébergeable ailleurs si besoin), `supabase/migrations/`.

## Moteur : ordre de traitement

1. Message du gérant (echo) → pause du bot pour ce contact (12 h par défaut).
2. Contact en pause → rien.
3. Session en cours qui attend une réponse → on continue le flux
   (bouton > mot-clé d'un autre flux > IA, puis on repose la question).
4. Mot-clé d'un déclencheur → on lance le flux.
5. Canal en mode `toujours` → IA de secours.
6. Sinon → ignoré.

Toutes les conditions jour/heure utilisent le fuseau du client (`America/Guadeloupe` par défaut).

## Secrets

Jamais de clé dans le code ni dans Git : `.env.local` en local, variables d'environnement
Vercel en production. `.gitignore` exclut tous les `.env*` sauf `.env.example`.
