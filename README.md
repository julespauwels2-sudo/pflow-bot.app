# PFlow Bots

Plateforme de chatbots WhatsApp des restos PFlow (`bots.pflow.fr`).
Application indépendante du CRM : une panne de l'un ne fait jamais tomber l'autre.

## Démarrer en local

```bash
npm ci               # installe exactement les versions du package-lock.json
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Sans `BASIC_AUTH_PASSWORD`, l'accès est libre en local. En production, l'app refuse
tout (503) tant que le mot de passe n'est pas défini.

## Installation et Vercel

- Node 22 (`engines.node` = `22.x`, respecté par Vercel). npm 10 ou 11.
- **Le `package-lock.json` doit rester versionné.** npm 10.9 a un bug qui le fait planter
  quand il construit l'arbre de dépendances *sans* lockfile (dépendances optionnelles de Vitest).
  Avec le lockfile, `npm ci` et `npm install <paquet>` fonctionnent normalement, en local comme sur Vercel.
- Si le lockfile devait être recréé de zéro, le faire avec `npx npm@11 install`.

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
src/data/     Accès aux données. repositories.ts = interfaces uniques (clients, flux, fiches d'infos,
              sauvegarde). local/ = implémentation localStorage (étape A). browser.ts = le seul
              endroit à changer pour brancher Supabase (étape B). schemas.ts = validation zod de
              tout JSON importé. transfer.ts = export / import.
src/lib/      Utilitaires (protection par mot de passe, fuseaux, fichiers).
src/proxy.ts  Protection de toutes les pages sauf /api/webhooks/.
src/app/      Interface Next.js : /clients, /clients/[id], /flows/[id].
```

À venir : `src/components/editor` (A4), simulateur (A5), IA (A6),
`src/channels/whatsapp` (webhook isolé, hébergeable ailleurs si besoin), `supabase/migrations/`.

## Données (étape A)

- Tout est dans le `localStorage` du navigateur (clé `pflow-bots:v1`). Des données illisibles ne sont
  jamais écrasées : elles sont copiées sous `pflow-bots:v1:corrompu:<date>`.
- **Flux** : un brouillon (édité) et une version publiée (utilisée par le bot). « Publier » copie le
  brouillon dans la version publiée et incrémente le numéro de version.
- **Export / import** : un flux seul (format `pflow-bots/flow`, importé en brouillon), ou la
  sauvegarde complète (format `pflow-bots/backup`, remplace tout).
- **Client** : nom, slug du mini-site (unique), fuseau horaire (`America/Guadeloupe` par défaut).

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
