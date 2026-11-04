# Journal de travail

Tenu pendant les absences de Jules. Chaque entrée : ce qui est fait, comment le vérifier, les choix faits
sans lui, les questions en attente.

## 5 novembre 2026 — session autonome (environ 1 h 30)

Règles respectées : aucune écriture dans les tables du CRM, aucune migration appliquée, rien dans le dépôt
`Pflow-Crm` (lu seulement), rien chez Meta. Écritures possibles seulement dans les tables `bot_` existantes
(aucune n'a été faite pendant cette session : tout est testé sur des bases simulées).

### Tâche 1 — Création automatique des bots ✅

**Fait**
- À chaque chargement de l'app (connecté à Supabase), tout resto du CRM en statut **signé, actif ou démo**
  qui n'a **aucune ligne** dans `bot_clients` reçoit son bot, lié au modèle maître, sans clic
  (`src/data/auto-bots.ts`, appelé par `ensureAutoBots()` dans `src/data/browser.ts`). Écriture uniquement
  dans `bot_clients`.
- La page **Clients** affiche « Bot créé automatiquement : … » et, sur chaque carte, l'état du bot et sa
  **liste de contrôle d'onboarding** (nombre de points à vérifier et les 3 premiers ; tout le détail sur la
  fiche du client).
- **Désactiver / réactiver** : nouveau bouton « Désactiver » sur la carte Bot (à côté de « Détacher du
  modèle »). Un bot désactivé n'a plus aucun flux actif et n'est jamais recréé ; « Réactiver (lié au
  modèle) » le relance. « Supprimer le bot » vide le bot et le désactive (il n'est donc pas recréé).
- Un bot détaché ou désactivé garde sa ligne `bot_clients` : la création automatique ne le touche plus.

**Comment vérifier**
1. Se connecter, ouvrir **Clients** : les restos signés/actifs/démo sans bot affichent « Bot créé
   automatiquement » puis « ✓ Bot prêt » ou « N points à vérifier ».
2. Ouvrir un resto → carte Bot → **Désactiver** : recharger la page, il reste désactivé. **Réactiver**.
3. Tests : `npm test` (fichier `src/data/__tests__/supabase-store.test.ts`, bloc « création automatique
   des bots »).

**Choix faits sans Jules**
- **Pas de nouvelle colonne** (migration interdite) : « bot désactivé » = ligne `bot_clients` avec
  `modele_id` vide et `lie_le` = date de désactivation. Une colonne `actif` explicite serait plus claire :
  à ajouter avec la migration C si Jules le souhaite.
- La création automatique tourne **dans le navigateur, à l'ouverture de l'app** (pas de tâche planifiée
  côté serveur). Un resto qui passe en « signé » dans le CRM reçoit son bot dès la prochaine ouverture de
  l'app. Une tâche serveur pourra s'ajouter à l'étape C (webhook) si besoin.
- Sans modèle maître dans Supabase, rien n'est créé (message affiché) : l'import des données du navigateur
  (`/import`) doit donc être fait d'abord.

**Questions en attente**
- Faut-il aussi créer automatiquement les bots des restos repassés en « perdu » puis en « signé » qui ont
  été désactivés entre-temps ? (Choix actuel, le plus prudent : non, un bot désactivé le reste.)

### Tâche 2 — Webhook WhatsApp, sans Meta ✅

**Fait** (`src/channels/whatsapp/`, indépendant de Next.js)
- **Webhook** `/api/webhooks/whatsapp` : vérification de l'adresse par Meta (GET, phrase
  `WHATSAPP_VERIFY_TOKEN`), **signature** `X-Hub-Signature-256` vérifiée sur le corps exact (clé
  `WHATSAPP_APP_SECRET`), **réponse 200 immédiate** puis traitement (`after()` de Next.js),
  **idempotence** (un message renvoyé par Meta n'est jamais retraité).
- **Lecture des notifications** : texte, boutons, listes, médias (réponse « je ne lis que l'écrit »),
  réactions ignorées, statuts d'envoi (envoyé, délivré, lu, échec), **échos de coexistence**
  (`smb_message_echoes` : le gérant a répondu depuis son appli → le bot se tait 12 h).
- **Envoi par l'API Graph** : texte, boutons de réponse, liste, bouton lien « Commander » (CTA URL),
  accusé de lecture avec « en train d'écrire » ; un envoi refusé par Meta est noté en échec, sans planter.
- **Branchement sur le moteur** : même bot que le simulateur (modèle + flux du client + agent IA, IA
  appelée côté serveur et journalisée « whatsapp »), canal en mode « test » (réponses seulement aux
  numéros de test), transferts notés pour la boîte de réception, alerte WhatsApp au gérant si possible.
- **Stockage** : deux implémentations de la même interface : Supabase (tables de la **migration C, pas
  encore appliquée**) et mémoire (tests et démo locale, refusée sur Vercel).
- **Inactif** (réponse 503) tant que `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN`,
  `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` ne sont pas toutes définies.

**Comment vérifier**
- Tests : `npm test` (`src/channels/whatsapp/__tests__/whatsapp.test.ts` : signature, lecture des
  notifications, formats Graph, et un scénario complet contre un faux serveur Meta lancé dans le test).
- De bout en bout (faux Meta, aucun vrai envoi) : voir `scripts/e2e/whatsapp.js` (commandes en tête du
  fichier). Résultat : vérification GET, refus d'un appel non signé, Accueil envoyé (bouton lien +
  boutons) avec réponse 200 en quelques ms, pas de doublon, boutons « Infos pratiques » → « Livraison »
  (jours fixes et points de vente), écho du gérant → silence.

**Choix faits sans Jules**
- Version de l'API Graph par défaut : `v24.0` (réglable par `WHATSAPP_GRAPH_VERSION`), à confirmer en C1.
- « En train d'écrire » plafonné à 3 s côté serveur (le webhook ne doit pas attendre trop longtemps).
- Format exact des échos de coexistence (`message_echoes`, champ `to`) écrit d'après la documentation
  connue : **à revérifier en C6**.
- Verrou de conversation « optimiste » simple (relecture de la version avant écriture) ; suffisant pour
  un message à la fois par contact, à renforcer si besoin.

**Questions en attente**
- Aucune bloquante. Rappel : la migration C (`docs/etape-c/migration-c.sql`) doit être validée et
  appliquée avant que le stockage Supabase du canal serve.

### Tâche 3 — Boîte de réception ✅

**Fait**
- Page **Boîte de réception** (`/inbox`, lien dans le menu) : conversations groupées par resto (numéro),
  celles qui attendent l'équipe en premier (🔔), état du bot (en pause, pourquoi, jusqu'à quand), fil
  façon WhatsApp (Client, Bot, Équipe, Gérant depuis l'appli), statuts (lu, échec). Actualisation toutes
  les 5 s.
- **Reprendre la main** : le bot se tait pour ce client, sans limite, et la conversation en cours est
  arrêtée. **Rendre au bot** : pause levée, alerte de transfert marquée traitée.
- **Répondre à la main** (dans la fenêtre de 24 h seulement) : envoyé par l'API Graph, affiché « Équipe ».
- Routes serveur `/api/inbox` (protégées par la connexion, comme `/api/ai`), même stockage que le webhook.
- **Mode démo** (stockage en mémoire) : « Simuler un message client » pour tout tester sans numéro.

**Comment vérifier** (sans Meta)
1. Lancer le faux Meta et l'app en mode démo (commandes en tête de `scripts/e2e/inbox.js`).
2. Ouvrir `/inbox`, « Simuler un message client » (« bonjour »), ouvrir la conversation, « Reprendre la
   main », simuler « vous êtes là ? » (le bot ne répond pas), répondre à la main, « Rendre au bot ».
3. Tests : `src/channels/whatsapp/__tests__/inbox.test.ts` ; parcours navigateur `scripts/e2e/inbox.js`.

**Choix faits sans Jules**
- Quand quelqu'un **répond depuis la boîte de réception**, le bot se met en pause 12 h (comme quand le
  gérant répond depuis son appli) pour ne pas couper la parole. « Rendre au bot » le relance tout de suite.
- **Reprendre la main** = pause sans fin (jusqu'à « Rendre au bot »), plutôt qu'une durée fixe.
- Actualisation par interrogation toutes les 5 s (pas de temps réel Supabase, qui demanderait de modifier
  une publication de la base : à revoir si besoin).

**Questions en attente**
- Faut-il que le gérant de chaque resto ait accès à SA boîte de réception (compte du dashboard, droit
  limité à son resto) ? Aujourd'hui, seuls les administrateurs du bot y ont accès.

### Tâche 4 — Patches PFlow Order ✅

**Fait** (`docs/etape-c/patches/`, un fichier par modification, détails dans son README)
- `01` événements de commande (aiguillage dans `api/_bot.js`), `02` panier abandonné (`api/_options.js`),
  `03` bouton « Retour sur WhatsApp » (`js/commande.js`), `04` pré-remplissage (nouveau
  `api/bot-contact.js` + `js/commande.js`), chacun avec ses tests au format de PFlow Order (`node:test`).
- Côté PFlow Bots : le message « ✅ Commande n° 42 passée » est reconnu (ni accueil ni IA), le bouton
  « Commander » sur WhatsApp porte `?via=wa` et le jeton chiffré de pré-remplissage.

**Comment vérifier**
- Lire les 4 diffs ; `git apply --check` depuis la racine de `Pflow-Crm` (commande dans le README).
- Le dépôt `Pflow-Crm` n'a reçu aucune modification ni commit (travail sur une copie dans le scratchpad).

**Choix faits sans Jules**
- Texte prérempli « ✅ Commande n° 42 passée » (proposition du plan, non encore validée).
- Le numéro WhatsApp du jeton **remplace** le téléphone déjà mémorisé sur la page (c'est lui qui relie la
  commande à la conversation) ; le prénom mémorisé est gardé s'il existe.
- Jeton valable 2 h, chiffré AES-256-GCM avec `PFLOW_BOTS_SECRET`.
- Pas de nouvelle colonne dans le CRM (rattachement par le numéro).

**Questions en attente**
- Valider le texte prérempli du bouton « Retour sur WhatsApp ».
- `api/notifier.js` exige `UCHAT_API_KEY` dans Vercel : à garder tant qu'un resto reste sur UChat
  (sinon à assouplir au moment de la bascule complète, C7).

### Résumé de la session

Tout ce qui pouvait être fait **sans Meta et sans migration** est fait et testé : création automatique
des bots, canal WhatsApp complet (testé contre un faux Meta), boîte de réception, patches PFlow Order.
Ce qui reste bloqué volontairement : C0 (compte Meta, par Jules), la migration C (à valider), la route
`/api/webhooks/pflow-order` (dépend de la migration C), l'application des patches (à valider).

## 5 novembre 2026 (suite) — réponses de Jules

- Patch 4 : le numéro WhatsApp remplace le téléphone mémorisé → **validé**.
- Texte « ✅ Commande n° 42 passée » → **validé**.
- Boîte de réception pour les gérants → **plus tard** (noté dans `docs/plan.md`).
- Bot désactivé → **jamais recréé automatiquement** (comportement actuel, confirmé).
- Hébergement → **Vercel gratuit pendant les tests** sur le numéro Meta ; décision avant la bascule du
  premier client.

## 5 novembre 2026 — deuxième session autonome (tâches 5 à 9)

Mêmes règles : aucune écriture dans le CRM ni dans les tables `bot_` réelles, aucune migration, rien dans
`Pflow-Crm`, rien chez Meta.

### Tâche 5 — Instagram ✅

**Fait**
- Le code des canaux est regroupé dans `src/channels/core/` (commun) ; `whatsapp/` et `instagram/` ne
  contiennent plus que la lecture des notifications et l'envoi. Le moteur est le même pour les deux.
- `POST/GET /api/webhooks/instagram` : vérification de la phrase, signature `X-Hub-Signature-256`
  obligatoire, traitement en arrière-plan, un renvoi de Meta n'est jamais traité deux fois.
- Lecture : texte, réponse rapide, bouton (postback), vocal (gardé pour la tâche 6), « vu » du client,
  écho du gérant (il répond depuis l'appli Instagram → le bot se met en pause, comme sur WhatsApp).
- Envoi adapté : boutons et listes → **réponses rapides** (13 max, 20 caractères) ; bouton « Commander »
  → modèle à bouton lien ; texte coupé à 1 000 caractères ; la mise en forme WhatsApp (`*gras*`…) est
  retirée car Instagram l'afficherait telle quelle.
- Éditeur : case **« Instagram »** (à côté de « Recentrer ») qui ajoute les limites d'Instagram à la
  vérification du flux : liste affichée en réponses rapides (avertissement), erreur au-delà de 13 choix
  ou de 20 caractères par choix, texte de bouton lien limité à 640.
- Boîte de réception : conversations Instagram sous le resto (📸), WhatsApp (💬) ; en mode démo, choix de
  la plateforme pour simuler un message.
- **Inactif** tant que `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN` et `INSTAGRAM_TOKEN` ne sont pas
  définis (la route répond « non configuré », aucun envoi).
- `docs/etape-c/guide-meta.md` : nouvelle section 9 (compte pro, « Autoriser l'accès aux messages »,
  permissions, webhook, validation de l'app avec accès avancé et vérification d'entreprise).
- `docs/etape-c/migration-c.sql` révisée (toujours **non appliquée**) : `bot_canaux` a une colonne
  `plateforme` et un `compte_id` (au lieu de `phone_number_id`), `bot_contacts.identifiant` (au lieu de
  `wa_id`), `source` des événements accepte `instagram`.

**Vérifié** : 296 tests (dont 4 Instagram contre un faux serveur), lint, types, build ; bout en bout
`scripts/e2e/instagram.js`, `whatsapp.js` et `inbox.js` (vrai navigateur) contre le faux Meta : tout passe.

**Choix faits sans toi (les plus prudents)**
- Sur Instagram, le lien « Commander » porte `?via=ig` **sans jeton de contact** : l'identifiant
  Instagram n'est pas un numéro de téléphone, il ne doit pas remplacer le téléphone du client dans
  PFlow Order (patch 4).
- Le nom du client Instagram n'est pas demandé à Meta (appel en plus, permission en plus) : la boîte de
  réception affiche « Instagram » + 4 derniers chiffres de l'identifiant tant qu'on n'a pas de nom.
- Nos propres envois reviennent en écho avec l'`app_id` de l'app : ignorés (sinon le bot se mettrait en
  pause tout seul). Un écho sans `app_id` = le gérant a répondu.
- Le « vu » et « en train d'écrire » ne partent que si le bot répond (si le bot est en pause, le client
  ne voit pas « vu » alors que personne n'a lu).

**Questions pour toi (non bloquantes)**
- PFlow Order, patch 3 : quand `via=ig`, faut-il un bouton « Retour sur Instagram »
  (`https://ig.me/m/<compte>`) au lieu de « Retour sur WhatsApp » ? Je n'ai rien modifié.
- Le token Instagram expire après 60 jours : renouvellement automatique à prévoir avant le premier
  client Instagram (noté dans le guide).

### Tâche 6 — Messages vocaux ✅ (inactif sans clé)

**Fait**
- Réception des vocaux WhatsApp (identifiant du média → adresse temporaire demandée à Meta →
  téléchargement avec le token) et Instagram (adresse dans la notification). Plafond 10 Mo ; adresses
  acceptées en https uniquement, jamais une adresse interne.
- `src/channels/voice/transcriber.ts` : **une interface, trois services interchangeables** (OpenAI,
  Mistral, Deepgram), choisis par `TRANSCRIPTION_PROVIDER` + `TRANSCRIPTION_API_KEY` (Vercel). Sans clé :
  rien ne change, le bot répond « je ne peux lire que les messages écrits » comme avant.
- Avec un service : le texte transcrit est passé au moteur **comme si le client l'avait écrit**
  (mots-clés, questions, IA). La boîte de réception affiche « 🎤 bonjour » ; en cas d'échec,
  « 🎤 Message vocal (non transcrit : …) » et le bot répond comme avant (pas de plantage).
- L'audio n'est **jamais stocké** : seul le texte transcrit est gardé avec le message.

**Vérifié** : 9 tests contre un faux Meta et un faux service (format d'appel de chaque service, token
envoyé à Meta mais pas au CDN Instagram, audio trop long refusé, service en panne, inactif sans clé,
statut qui ne contient jamais la clé, adresses internes refusées).

**Comparaison des services (aucun choisi — à toi de décider)** — prix relevés le 4 novembre 2026 sur des
sites tiers, **à vérifier sur les pages officielles** :

| Service (modèle par défaut) | Prix / minute | 100 vocaux de 30 s / mois | Français | Créole |
|---|---|---|---|---|
| Mistral — Voxtral Mini Transcribe | ≈ 0,003 à 0,0035 $ | ≈ 0,17 $ | Très bon (entreprise française, le français est une langue phare) | Rien d'annoncé |
| OpenAI — gpt-4o-mini-transcribe | ≈ 0,003 $ (whisper-1 : 0,006 $) | ≈ 0,15 $ | Très bon | Whisper connaît le créole haïtien, proche mais pas identique au créole antillais ; rien d'annoncé pour la Guadeloupe/Martinique |
| Deepgram — Nova-3 | ≈ 0,0043 $ (multilingue ≈ 0,0052 $) | ≈ 0,22 $ | Bon | Rien d'annoncé |

Dans tous les cas le coût reste négligeable (quelques centimes par mois et par resto). Le vrai critère
est la qualité sur **des vocaux réels de clients antillais** (accent, mélange français/créole, bruit) :
proposition de test quand tu auras du temps → 10 vocaux de toi ou d'amis, passés dans les trois
services (il suffit de changer `TRANSCRIPTION_PROVIDER`), et on compare. Le créole pur sera
probablement mal transcrit partout ; l'IA du bot peut quand même comprendre une transcription
approximative.

**Choix faits sans toi** : pas de limite de vocaux par client (le plafond de taille suffit au vu des
prix) ; la transcription a lieu même si le bot est en pause, pour que le gérant puisse lire le vocal
dans la boîte de réception.

### Tâche 7 — Page « État du système » ✅

**Fait** : page `/etat` (lien « État » dans le menu du compte) et route `/api/etat`, réservée aux comptes
de `bot_admins` (sans Supabase configuré, protégée par le mot de passe provisoire du site).
- **Clés détectées** : 14 variables, affichées « présente / absente ». La valeur n'est jamais lue
  au-delà de « vide ou pas », ni renvoyée (un test le vérifie avec de fausses clés).
- **Canaux** : webhook WhatsApp / Instagram actif ou non, ce qui manque, nombre de comptes reliés
  (actifs / en test) ; IA (modèle utilisé) ; messages vocaux (service) ; stockage ; hébergement.
- **Bots** : nombre de bots actifs (liés au modèle, non désactivés), désactivés, coût IA sur 30 jours.
- **Derniers appels IA** (10) et **dernières erreurs IA** (10), avec le resto et le coût.
- **Derniers événements reçus** par les webhooks, identifiants masqués, avec l'erreur s'il y en a.

**Vérifié** : 2 tests de la route (aucune valeur de clé dans la réponse, refus sans connexion), capture
en mode démo après le test WhatsApp de bout en bout.

**Choix fait sans toi** : les appels IA venus d'Instagram sont notés « whatsapp » (canal réel) car la
contrainte de `bot_appels_ia` n'accepte pas « instagram ». L'élargissement est ajouté à la migration C
(**non appliquée**, nom de la contrainte vérifié en lecture seule : `bot_appels_ia_source_check`).
