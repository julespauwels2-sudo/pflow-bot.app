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

Connexion : si `BASIC_AUTH_USER` n'est pas défini, **n'importe quel nom d'utilisateur** est
accepté (seul le mot de passe compte). S'il est défini, le nom doit correspondre.
Après avoir modifié une variable d'environnement sur Vercel, il faut **redéployer**.

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
src/editor/   Logique pure de l'éditeur, testée : catalogue des blocs et de leurs sorties, limites
              WhatsApp, vérification avant publication (lint), annuler/rétablir, copier/coller,
              variables.
src/components/editor/  Tableau blanc React Flow (état centralisé dans state.ts).
src/lib/      Utilitaires (protection par mot de passe, fuseaux, fichiers).
src/proxy.ts  Protection de toutes les pages sauf /api/webhooks/.
src/app/      Interface Next.js : /clients, /clients/[id], /flows/[id].
```

À venir : simulateur (A5), IA (A6),
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
5. Canal en mode `toujours` → flux par défaut s'il existe, sinon IA de secours.
6. Sinon → ignoré.

Toutes les conditions jour/heure utilisent le fuseau du client (`America/Guadeloupe` par défaut).

## Éditeur (étape A4)

- Blocs glissables depuis la palette, reliés par des flèches. Chaque bouton, choix de liste ou
  issue de condition a sa propre sortie ; une sortie ne mène qu'à un seul bloc.
- Brouillon enregistré automatiquement (0,6 s après chaque modification, et à la fermeture de l'onglet).
- Vérification en continu, affichée sur les blocs : bloc non relié, bouton non relié, limites
  WhatsApp (3 boutons de 20 caractères, 10 choix de 24 caractères…), variable inconnue, flux de
  destination manquant… « Publier » est bloqué tant qu'il reste une **erreur** ; les
  **avertissements** n'empêchent pas de publier.
- **Bloc Message façon UChat** : plusieurs bulles à la suite. Sous chaque bulle, « + Ajouter un
  bouton » propose un **bouton de réponse** (une sortie par bouton) ou un **bouton lien** (URL libre
  en `https://`, ou « Lien de commande » calculé avec le slug du client). Règle WhatsApp imposée :
  dans une bulle, soit 1 à 3 boutons de réponse, soit 1 bouton lien, jamais les deux. Sortie
  **« Étape suivante »** en bas du bloc : reliée, la suite part tout de suite et les boutons restent
  cliquables ; non reliée, le bot attend un clic. Les anciens blocs « Boutons » et « Lien de
  commande » sont convertis automatiquement (stockage, import, collage ; copie des données d'avant
  sous `pflow-bots:v1:avant-conversion-bulles`).
- **Flux par défaut** (case dans le déclencheur) : lancé par n'importe quel message quand aucun
  mot-clé ne correspond et qu'aucune conversation n'est en cours. Un seul par client ; interdit si
  le client est en mode « mots-clés uniquement ».
- **Délai** : pause avec « en train d'écrire », fixe (0,5 à 10 s) ou intelligent (1 à 5 s selon la
  longueur du message suivant).
- Raccourcis : Ctrl+Z / Ctrl+Y, Ctrl+C / Ctrl+V (aussi d'un flux à l'autre), Ctrl+D, Ctrl+A,
  Suppr, Maj + glisser pour sélectionner une zone, `{{` ou le bouton `{x}` pour insérer une variable.

## Secrets

Jamais de clé dans le code ni dans Git : `.env.local` en local, variables d'environnement
Vercel en production. `.gitignore` exclut tous les `.env*` sauf `.env.example`.
