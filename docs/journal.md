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

### Tâche 8 — Audit de sécurité ✅

Rapport complet : **[docs/securite.md](securite.md)**. En bref :
- **Déjà bon** : pages et routes protégées (mot de passe provisoire + connexion + RLS), 8/8 tables
  `bot_` avec RLS et fermées à `anon` (le conseiller Supabase ne signale rien sur elles), aucun
  secret dans tout l'historique Git, webhooks signés, journaux sans numéro ni message en clair.
- **Corrigé sans migration** : en-têtes de sécurité sur tout le site, limites de débit sur l'IA
  (30/min/compte) et la boîte de réception (120/min/compte), purge des messages après 12 mois
  **préparée et testée mais non activée**, `.env.example` complet.
- **Reste à décider** (classé dans le rapport) : activer la purge, politique de confidentialité
  publique (exigée par Meta), clause RGPD dans les contrats restos, pare-feu Vercel, CSP complète.
- **Vu côté CRM, pas touché** : le conseiller Supabase signale une vue en *security definer*
  (`vitrine`) et beaucoup de fonctions appelables par `anon` — à regarder à part, rien à voir avec
  le bot.

**Vérifié** : 311 tests, lint, types, build ; en-têtes présents (curl) ; sans mot de passe `/clients`
et `/api/etat` → 401 ; e2e WhatsApp, Instagram et boîte de réception passent avec les nouveaux en-têtes.

### Tâche 9 — Guide d'onboarding ✅

**[docs/guide-onboarding.md](guide-onboarding.md)** : lancer un resto de A à Z pour quelqu'un qui n'a
jamais vu la plateforme — vue d'ensemble (CRM = source, bot, Meta), prérequis, CRM (champs à vérifier),
création automatique du bot, fiche d'infos (tableau champ → question du client), réglages (« Le bot
répond… » selon le numéro), liste de contrôle, 7 scénarios au simulateur, connexion WhatsApp (étape C,
marquée « pas encore active »), suivi (boîte de réception, État du système), problèmes fréquents et
récapitulatif à cocher. La page d'accueil indique maintenant B « fait » et C « en cours ».

### Résumé de la deuxième session

Tâches 5 à 9 faites, testées et poussées (un commit par tâche). Rien d'écrit dans le CRM ni dans les
tables `bot_` réelles, aucune migration, rien dans `Pflow-Crm`, rien chez Meta (seules des lectures du
catalogue Supabase pour l'audit). 311 tests, lint, types et build passent ; bouts en bout WhatsApp,
Instagram et boîte de réception passent contre le faux Meta.

Décisions qui t'attendent (aucune n'est bloquante) :
1. Migration C (révisée pour Instagram + contrainte `bot_appels_ia`) : à relire et valider.
2. Service de transcription des vocaux : à choisir après un essai sur de vrais vocaux (tâche 6).
3. PFlow Order : bouton « Retour sur Instagram » quand `via=ig` ? (tâche 5).
4. Sécurité : activer la purge, politique de confidentialité, clause RGPD (docs/securite.md § 7).

## À tester par Jules — ancienne liste (5 novembre, remplacée par celle du 8 novembre en fin de journal)

Sur le site déployé de la branche, connecté avec ton compte.

| # | Où | Quoi faire | Résultat attendu | Durée |
|---|---|---|---|---|
| 1 | Menu du compte → **État** | Ouvrir la page | Clés Supabase et IA « présente », WhatsApp / Instagram « inactif » (normal), tes bots actifs comptés, aucune valeur de clé visible | 2 min |
| 2 | **Simulateur** | « bonjour » puis une question libre (« vous livrez à Jarry ? ») | Accueil + bouton Commander ; réponse de l'IA **sans lien** | 3 min |
| 3 | **Clients** | Regarder la liste de contrôle de 2 restos | Pas d'erreur rouge inattendue | 2 min |
| 4 | **Éditeur** d'un flux avec une liste (ex. Infos pratiques) | Cocher la case **« Instagram »** à côté de « Recentrer » | Avertissement « affichée en réponses rapides » ; erreur si un choix dépasse 20 caractères | 2 min |
| 5 | **Boîte de réception** | Ouvrir la page | Message « Aucun canal (WhatsApp, Instagram) n'est encore branché », liste des variables manquantes | 1 min |
| 6 | `docs/guide-onboarding.md` | Le lire en entier | Clair pour quelqu'un qui découvre ? Note ce qui manque | 5 min |
| 7 | `docs/securite.md` § 7 | Lire le tableau « Reste à faire » | Me dire quels points tu veux traiter et quand | 4 min |
| 8 | `docs/etape-c/migration-c.sql` | Relire les changements Instagram (en tête de fichier et avant le RLS) | OK ou corrections, avant de l'appliquer à l'étape C | 5 min |
| 9 | `docs/etape-c/guide-meta.md` § 9 | Lire la partie Instagram | Rien à faire maintenant ; savoir ce qui attend pour Instagram | 3 min |
| 10 | Le tableau de la tâche 6 (ci-dessus) | Lire la comparaison des services vocaux | Choisir plus tard, après un essai avec 10 vrais vocaux | 2 min |

## 5 novembre 2026 — troisième session autonome (tâches 10 à 12)

Mêmes règles : rien dans le CRM, rien dans `Pflow-Crm`, aucune migration, rien chez Meta.

### Tâche 10 — Sécurité du CRM ✅ (analyse seulement, rien appliqué)

**[docs/securite-crm.md](securite-crm.md)** : 12 points classés par gravité, risque concret en
langage simple et SQL proposé. Fait en **lecture seule** (catalogue de la base, code des fonctions,
copie locale de `Pflow-Crm`).
- **Bonne nouvelle** : aucune table lisible sans règle ; les fonctions d'admin vérifient toutes
  `est_admin()` ; les 72 fonctions du pont vérifient `PONT_CLE` ; les liens publics utilisent des
  jetons longs.
- **À traiter en premier** : (1) les buckets publics `menus` / `contenu-video` sont **listables** et
  leurs dossiers sont des jetons → quelqu'un pourrait réécrire un questionnaire de démarrage encore
  ouvert (3 aujourd'hui) ; (2) tout le pont repose sur une seule clé : vérifier sa longueur ;
  (3) comptes admins sans double authentification.
- Le point « vue `vitrine` » (signalé « erreur ») est **voulu** (mini-site) : risque faible, liste de
  tes clients récupérable ; proposition d'un simple commentaire à court terme.
- Piège évité : `qg_sport_*` est utilisée par ta page Sport, le SQL proposé ajoute une vérification au
  lieu de retirer le droit.

### Tâche 11 — Politique de confidentialité et clause RGPD ✅ (premiers jets)

Dans **[docs/legal/](legal/README.md)** :
- `politique-confidentialite.md` : deux rôles (PFlow sous-traitant pour les clients des restos,
  responsable pour ses propres clients et prospects), données, finalités et bases légales, IA (Claude,
  pas de décision automatisée, possibilité de parler à une personne), vocaux (audio non conservé),
  sous-traitants (Meta, Anthropic, Supabase, Vercel, transcription), transferts, durées (12 mois…),
  droits, CNIL.
- `clause-rgpd-sous-traitance.md` : article 28 complet (instructions, confidentialité, sécurité,
  sous-traitants ultérieurs avec préavis, droits des personnes, violation sous 48 h, fin de contrat,
  audits proportionnés, transferts) + annexes (description du traitement, sous-traitants, mesures de
  sécurité).
- `README.md` : **6 points à aligner avant publication** (surtout : la purge des 12 mois n'est pas
  encore activée, et les fonctions Vercel tournent probablement aux États-Unis faute de région réglée)
  et les points de droit à trancher (montage WhatsApp avec Meta, paiement en ligne, base légale).

### Tâche 12 — Checklist C0 ✅

**[docs/etape-c/checklist-c0.md](etape-c/checklist-c0.md)** (liée depuis le README de l'étape C) :
dans l'ordre — ce qui prend des jours (politique de confidentialité en ligne, site, e-mail pro,
documents pour la vérification d'entreprise), les accès à vérifier la veille, le matériel (ordinateur,
ton téléphone, pas de carte bancaire ni de puce pour C0), la phrase à préparer, le déroulé du jour J en
9 étapes (≈ 1 h), ce qu'il ne faut pas faire, ce que tu me donnes à la fin.
Vérifié dans le code : avec les 3 variables WhatsApp mais sans `SUPABASE_SERVICE_ROLE_KEY`, le webhook
reste inactif (« canal non configuré ») : C0 ne peut rien déclencher.

### Fin de la troisième session

Tâches 10 à 12 faites et poussées. Rien appliqué dans la base, rien modifié dans `Pflow-Crm` (copie
locale vérifiée intacte), rien chez Meta. **Je m'arrête ici** : on reprend ensemble avec la liste
« À tester par Jules » ci-dessus, puis tes décisions sur `securite-crm.md` et `docs/legal/`.

## Retour de Jules — ajustements

- **Page Clients en deux onglets** : « Clients » (signé, actif, et les anciens statuts d'un resto qui a
  déjà un bot) et « Démos » (démo), avec le nombre dans chaque onglet. L'onglet est recalculé à chaque
  chargement depuis le statut du CRM : un resto qui passe de démo à signé change d'onglet tout seul.
  Le dernier onglet ouvert est retenu dans le navigateur. Pas d'onglets en mode local (pas de statut).
- **Liste de contrôle** : infos **obligatoires** (`horaires`, `horaires_du_jour`, `adresse`,
  `modes_service`, `infos_pratiques`, et `infos_livraison` si le resto livre) → point à vérifier ;
  infos **facultatives** (`points_de_vente`, `modes_paiement`…) → simple info grise, et la fiche affiche
  « Tout est prêt » s'il ne reste que des infos.
- **Modes de paiement** : recherche en lecture seule faite, rien modifié (en attente de ta décision).
- **Paiement** (décision de Jules : le paiement en ligne fait partie de l'offre de base) :
  - le mode réellement en vigueur est lu dans le CRM par `paiement_mode_public` (lecture seule ; le
    bot ne peut appeler qu'une liste blanche de fonctions de lecture, test à l'appui) ;
  - phrase grisée « CRM » sans nom de prestataire : « Vous pouvez payer *en ligne par carte* au moment
    de la commande, ou *sur place*. » / « Le paiement se fait *en ligne par carte*… » / « Le paiement
    se fait *sur place*[, au comptoir ou à la livraison]. » ; le champ devient « Précisions sur place
    (facultatif) », ajouté après la phrase (« Sur place : … »), ignoré si paiement en ligne obligatoire ;
  - liste de contrôle : « Paiement en ligne pas encore configuré (SumUp ou Stripe) » quand rien n'est en
    vigueur et que le resto n'a pas coupé le paiement en ligne lui-même (réglage « coupé » du CRM) ;
  - note ajoutée dans `docs/plan.md` : les seules options payantes côté bot sont celles du CRM.
  - ⚠️ **Côté CRM (pas touché)** : la fonction `paiement_mode_public` vérifie encore `module`
    (l'ancienne « option vendue »). Un resto avec `module = false` reste « sur place » même avec un
    prestataire prêt (cas de Cookies An Nou). À corriger dans PFlow Order si l'option n'existe plus.

## Démos sur le numéro PFlow ✅

**Le besoin** : toutes les démos sur le numéro WhatsApp PFlow ; le prospect écrit le mot-clé de sa démo
(le nom du resto, modifiable) ; sans mot-clé, un bot PFlow de base figé ; 5 jours (Prolonger), puis
suppression du bot (données `bot_` seulement) ; un resto passé signé ou actif garde son bot.

**Fait**
- **Lien « Commander »** (lu en lecture seule dans le CRM) : PFlow Order a déjà une page de commande de
  DÉMONSTRATION, `order.pflow.fr/demo/commande?d=<code>` (table `qg_demo_liens`, bouton « Préparer la
  démo » du CRM). Elle sert la vraie page de commande **en mémoire** : rien n'est écrit en base, aucun
  message ne part. Le bot d'une démo l'utilise **toujours**, jamais le vrai slug ; pas de jeton de
  contact. Sans code de démo dans le CRM : pas de bouton, et la page Démos le signale (« Préparer la
  démo dans le CRM »). Le bot ne crée jamais ce code lui-même (ce serait une écriture dans le CRM).
- **Commandes de démo sans effet** : la page de démo n'écrit rien ; le numéro PFlow n'a pas de resto,
  donc aucun événement de commande ne peut y être relié (règle notée pour le futur webhook PFlow Order).
- **Mots-clés** normalisés (casse, accents, ponctuation), uniques parmi les démos en cours, **prioritaires**
  sur les mots-clés du modèle : l'aiguillage les regarde avant le moteur.
- **Aiguillage** (`src/demos/router.ts`, partagé par le webhook et le simulateur) : mot-clé de démo →
  la démo démarre (conversation remise à zéro) ; sinon la démo en cours tant que la session vit
  (30 min sans message, réglage du canal) ; sinon le bot PFlow de base (`src/demos/pflow-bot.ts`, figé,
  sans IA : présentation, « Découvrir PFlow », « Obtenir ma démo » → transfert à toi). Mot-clé d'une
  démo terminée → « La démo de X est terminée… ».
- **Création / expiration** : la création automatique démarre la démo des restos en statut démo ;
  à l'expiration, au chargement suivant de l'app, les données `bot_` sont supprimées (jamais le CRM) et
  le bot n'est pas recréé tant que le resto reste en démo ; s'il est passé signé ou actif, la démo
  s'efface et le bot reste.
- **Page « Démos »** (menu) : mot-clé modifiable, expiration, nombre de conversations (contacts qui ont
  ouvert la démo), Prolonger de 5 jours, Supprimer ; démos terminées listées à part.
- **Simulateur** : « 📱 Numéro PFlow (démos) » (`/simulateur?numero=pflow`) : mêmes règles que le webhook,
  liste des mots-clés cliquable, avance du temps (+31 min, +1 jour, +6 jours), journal de l'aiguillage.
- **Boîte de réception** : le numéro PFlow apparaît comme « Numéro PFlow (démos) », avec la démo en cours
  de chaque prospect.

**Migration** : ⚠️ nécessaire, **ajoutée à `docs/etape-c/migration-c.sql`** (toujours non appliquée) :
nouvelle table `bot_demos` (mot-clé, mot-clé normalisé unique parmi les démos en cours, durée,
expiration, suppression), `bot_canaux.role` (« resto » / « pflow ») avec `restaurant_id` facultatif pour
le numéro PFlow, `bot_contacts.demo` (démo en cours). **Avant la migration** : les démos sont en lecture
seule dans la page Démos, rien n'est créé ni supprimé, et les bots des démos sont créés comme avant.

**Vérifié** : 336 tests (dont aiguillage, mots-clés, cycle de vie avec le CRM simulé, numéro PFlow
contre un faux Meta) ; dans un vrai navigateur (`scripts/e2e/demos.js`) : page Démos (démarrer, mot-clé
« BYRÔN » refusé car déjà pris par Byron, Prolonger, Supprimer) et simulateur (bonjour → PFlow, BYRON →
démo, bouton dans la démo, autre mot-clé, fin de session, démo expirée) ; sur le vrai serveur avec le
faux Meta (`scripts/e2e/numero-pflow.js`) ; WhatsApp et boîte de réception toujours verts.

**Choix faits sans toi (les plus prudents)**
- Les démos qui existent déjà (Gwada food, Gwada Smash Burger) **démarrent à la création de leur
  démo**, pas à la date de leur bot : sinon elles seraient supprimées dès le premier chargement.
- Mot-clé reconnu si le message **est** le mot-clé (ou « démo X ») ; hors d'une démo, aussi dans un
  court message (« Bonjour Byron »). Dans une démo, un nom au milieu d'une phrase ne fait pas changer de
  démo (ex. « je viens de chez Mexico »).
- Une démo expirée mais pas encore nettoyée est déjà traitée comme terminée (message poli).
- La suppression automatique se fait **au chargement de l'app** (pas encore de tâche planifiée) : à
  passer en Vercel Cron avec l'étape C.
- Un resto passé signé ou actif reste joignable par son mot-clé jusqu'à l'expiration de la démo, puis la
  démo s'efface ; son bot n'est jamais supprimé.
- Les textes du bot PFlow ne promettent rien qui ne soit sûr (ni prix, ni commission) : à relire.

**Questions pour toi (non bloquantes)**
- Textes du bot PFlow de base (`src/demos/pflow-bot.ts`) : à relire et ajuster (c'est du code, donc figé
  pour les prospects, comme demandé).
- Le numéro PFlow : quel numéro exactement (le tien en coexistence, ou une puce dédiée) ? À voir en C0.

## Suite — paiement des démos, patch paiement, sécurité du CRM

- **Démos** : « Paiement en ligne pas encore configuré » s'affiche en simple info grise pour un resto en
  démo (liste de contrôle et fiche d'infos) ; reste un point à vérifier pour les autres.
- **Patch 05** (`docs/etape-c/patches/05-paiement-offre-de-base.diff`, non appliqué) : l'ancienne option
  vendue (`paiement_restos.module`) ne bloque plus rien (SQL `qg64` rejouable + Atelier, Dashboard,
  supervision, API). **Facturation non touchée** (79 €, MRR, fiche de prix : décision à prendre).
  Aujourd'hui, le paiement en vigueur ne change pour aucun resto ; Cookies An Nou et les deux démos
  passent de « option non vendue » à « dossier à préparer » dans l'Atelier. Testé sur une copie à jour
  du CRM (`58c5b5a`) : nouveau test + 140 tests existants verts. Tableau par resto dans le README des patches.
- **Sécurité du CRM, point 4 — appliqué** (seule exception autorisée) : `qg_onboarding_lancer` n'est plus
  exécutable par `anon` ni `authenticated`. Avant : aucun appel depuis le code du CRM (vérifié sur la
  dernière version). Après : le déclencheur de signature est actif et s'exécute en `postgres`, qui garde
  le droit. ⚠️ Ce déclencheur avale les erreurs : vérifier l'onboarding à la prochaine signature.
- **Point 5 — exécuté, sans effet** : les fonctions `net.*` sont ouvertes via le droit public de
  `supabase_admin`, que la commande autorisée ne retire pas. Rien fait de plus (il faudrait le support
  Supabase). Risque faible tant que `net` n'est pas exposé par l'API.
- **Point 1** : plan de test de 5 minutes (avec retour arrière) dans `docs/securite-crm.md`.
- **Point 2** : procédure exacte pour changer `PONT_CLE` dans `docs/securite-crm.md`. **Correction de
  l'audit** : la clé n'est pas que sur Vercel, elle est aussi dans le Bot Field `pflow_cle` de chaque bot
  UChat et dans un secret GitHub. Comme `api/pont.js` n'accepte qu'une clé, j'ai préparé le **patch 06**
  (facultatif, testé) qui accepte `PONT_CLE_ANCIENNE` pendant la transition : aucune coupure des bots.
- Les patches 01 à 06 s'appliquent tous, dans l'ordre, sur la dernière version du CRM (`58c5b5a`).

## Décisions de Jules (6 novembre 2026)

- **Option paiement en ligne à 79 € retirée** → **patch 07** (`docs/etape-c/patches/07-option-paiement-retiree.diff`,
  non appliqué, à appliquer après le 05). Constat en lecture seule : l'option est **déjà à 0 €** en base
  (catalogue et 8 lignes de restos) et aucune facture ne l'a portée ; les 79 € ne sont que dans le code.
  Le patch : SQL `qg65` (module « inclus dans la formule », retiré des options, ancienne fiche
  sauvegardée), plus de bouton « +79 € » (fiche, signature, offre), MRR et mensualité sans elle,
  « Paiement en ligne — inclus » sur le Dashboard du resto, démo et guide mis à jour. 204 tests du CRM
  verts. Une première version rendait aussi le paiement « accessible à tous » (`pf_module_ok`) : les tests
  ont montré qu'une ligne de paiement serait alors créée pour chaque resto → retiré du patch. Point restant
  noté : la checklist d'installation (étape « Paiement » seulement pour les anciens détenteurs de
  l'option, et Stripe seulement).
- **`PONT_CLE`** : jamais fuité, pas de changement ; patch 06 mis de côté ; **renouveler la clé après
  l'arrêt d'UChat** (noté dans `docs/plan.md`).
- **Point 1 (buckets listables)** : **à faire avant le prochain questionnaire d'onboarding envoyé à un
  client** (le plan de test de 5 minutes est prêt dans `docs/securite-crm.md`). À ne pas oublier.

## C1 — webhook branché, passage en Live préparé (7 novembre 2026)

- **Diagnostic** : Meta a bien envoyé le message de Jules au webhook (journaux Vercel, 04 h 12 UTC). L'échec
  vient de la **migration C non appliquée** (table `bot_webhook_evenements` absente), pas du mode
  Développement. → Appliquer la migration C (parties A et B, en attente du OK de Jules) puis refaire le test.
- **Politique de confidentialité** : `docs/legal/site/confidentialite.html` remplace la page actuelle de
  pflow.fr (périmée : sans PFlow Bots, Anthropic ni suppression des données), avec le gabarit exact du
  site (dépôt `Site-PFlow`, lu en lecture seule, rien poussé). Nouvelle page `suppression-donnees.html`.
  Identité lue dans `infos-legales.js` du site : aucune case à compléter (vérifié dans un navigateur, ordinateur
  et téléphone).
- **Mode Live** : `docs/etape-c/checklist-live.md` (champs exigés par Meta, valeurs à coller, icône
  1024 × 1024 dans `docs/etape-c/meta/`). Pas nécessaire pour le test ; le sera pour les vrais numéros.
- **Publication sans effet** sur les numéros UChat (autre app Meta) et sur les autres apps de Jules (chaque
  app a son propre mode).

### Migration C appliquée (7 novembre 2026, OK de Jules)

- **Partie A** (tables) appliquée sur Supabase : migration versionnée `supabase/migrations/20261107000000_bot_canaux.sql`
  (même SQL que `docs/etape-c/migration-c.sql`, vérifié ligne à ligne). Uniquement des créations de tables `bot_` ;
  aucune table ni donnée du CRM touchée.
- **Partie B** : ligne `bot_canaux` du numéro de test (Phone number ID 1482722121584900, Cookies An Nou, mode
  « toujours », état « test », seul destinataire autorisé +590 690 93 81 08).
- **Vérifié** : les 7 tables existent (`bot_canaux`, `bot_contacts`, `bot_sessions`, `bot_messages`,
  `bot_transferts`, `bot_webhook_evenements`, `bot_demos`), RLS activé avec sa politique sur chacune ;
  `bot_appels_ia` accepte la source `instagram`. Conseiller sécurité Supabase : aucune alerte sur ces tables
  (les alertes `bot_*` restantes visent les anciennes fonctions du pont UChat, déjà suivies dans
  `docs/securite-crm.md`).
- Suite : Jules réécrit « Bonjour » au numéro de test. Mode Live avant le premier client (pages légales publiées
  par Jules lui-même).

### Test « Bonjour » sans réponse (7 novembre 2026, 04 h 28 UTC) : diagnostic

- **Meta n'a pas envoyé le vrai message** : aucun appel du webhook après 04 h 23, aucune ligne dans
  `bot_webhook_evenements`, `bot_contacts`, `bot_sessions` ni `bot_messages`.
- **Correction du diagnostic précédent** : les appels de 04 h 12 et 04 h 23 UTC étaient le **message d'exemple
  du bouton « Tester »** de Meta (identifiant `ABGGFlA5Fpa`, le même deux fois), pas le « Bonjour » de Jules.
  `checklist-live.md` corrigé.
- Côté PFlow Bots, tout répond : adresse du webhook active (vérification refusée avec un faux jeton, comme prévu),
  variables Vercel inchangées depuis la vérification, signature acceptée lors des appels de test.
- **Ajout** : une ligne de journal par appel de Meta (« reçu : N message(s) … traités / ignorés + raison /
  erreurs », sans numéro ni texte), un avertissement en cas de signature invalide, et la mention du faux message
  du bouton « Tester ». Test `webhook-summary.test.ts`.
- **À faire par Jules (Meta)** : vérifier l'abonnement au champ `messages` puis le lien app ↔ compte WhatsApp
  (`subscribed_apps`), guide pas à pas dans `guide-meta.md` §6 « Dépannage ».

### Passage en Live préparé (7 novembre 2026)

- **Cause du silence confirmée par Jules** : `subscribed_apps` correct ; l'app en mode Développement ne reçoit
  que les webhooks de test. → Passage en Live.
- **Suppression automatique activée** (demande de Jules) : Vercel Cron quotidien (`vercel.json`,
  `/api/cron/purge`, protégé par `CRON_SECRET`, refus sans lui). Conversations (`bot_messages`, `bot_transferts`,
  `bot_sessions`) et `bot_appels_ia` : 12 mois ; `bot_webhook_evenements` : 30 jours. Fiches de contact gardées
  (STOP). `PURGE_ACTIVE=non` suspend la suppression. Colonnes vérifiées sur la base réelle. **Reste : `CRON_SECRET`
  dans Vercel (Jules).**
- **Page de confidentialité** : « @pflow.gp : 12 mois » était inexact (le CRM ne supprime pas
  `qg_motcle_messages`, vérifié en lecture seule) → aligné sur la règle des prospects (3 ans). Pour revenir à
  12 mois, il faudrait une suppression côté CRM (décision de Jules).
- **PR Site-PFlow** : https://github.com/julespauwels2-sudo/Site-PFlow/pull/3 (branche `pages-legales-bots`,
  non fusionnée, à fusionner par Jules).
- **Checklist Live pas à pas** : `docs/etape-c/checklist-live.md` (étape 0 avant Meta, champs dans l'ordre de
  la page « Général », autorisations, publication, vérification).

### Premier vrai message reçu, envoi refusé par Meta (7 novembre 2026, 05 h 24 UTC)

- **Réception OK depuis le passage en Live** : 4 « Bonjour » reçus (04 h 46, 04 h 47, 04 h 48, 05 h 24 UTC),
  contact créé, réponse calculée (lien + boutons), tout enregistré.
- **Envoi refusé** : `(#10) Viewer cannot access the provided Paid Message Account 1511896410913657` = le token
  `WHATSAPP_TOKEN` n'a pas accès au compte WhatsApp de test. Correction côté Meta (Jules) : attribuer le compte
  WhatsApp à l'utilisateur système `pflow-bots-serveur` (contrôle total), régénérer le token, le mettre dans
  Vercel, redéployer. Guide : `guide-meta.md` §6 « Dépannage ».

### Erreur (#10) persistante avec le nouveau token (7 novembre 2026, 05 h 39 UTC)

- Token régénéré (05 h 34 UTC), compte de test attribué en accès total, débogueur : « Applies to all objects ».
  Test de 05 h 39 sur un déploiement postérieur au token (`dpl_EBGs…`, prêt à 05 h 39 min 08 s) : **toujours #10**.
- Piste (modèle de comptes de Meta en évolution, cf. PR Chatwoot 16477) : un numéro peut avoir plusieurs
  « comptes de messagerie » ; sans `messaging_account_id`, Meta choisit lui-même. **Ajouté** : chaque envoi
  WhatsApp porte `messaging_account_id` = WABA du canal. Erreurs Meta plus complètes (sous-code, détail, trace).
- **Bouton « Tester l'accès du token »** sur la page État : lectures seules (numéro, compte et portefeuille
  propriétaire, numéros du compte, apps abonnées), aucun envoi.

### Cause de l'erreur #10 trouvée par Jules (7 novembre 2026)

- `1511896410913657` est le **compte de messagerie** (Test Messaging Account), pas le WABA. Vrai WABA du numéro
  de test : `1440277184838867`. Jules a attribué les **deux** éléments à `pflow-bots-serveur` (accès total).
- `bot_canaux.waba_id` corrigé (1440277184838867) à la demande de Jules (une ligne, table du bot).
- Code : `messaging_account_id` des envois = compte de messagerie du canal (nouvelle colonne), **plus le WABA** ;
  sans valeur, le champ est omis (Meta choisit). Bouton « Tester l'accès du token » : WABA et compte de messagerie
  testés séparément.
- **Migration C2 appliquée** (OK de Jules) : `supabase/migrations/20261107010000_bot_canaux_compte_messagerie.sql` (colonne
  `messaging_account_id` ; numéro de test : 1511896410913657).
- `guide-meta.md` : « Deux éléments à attribuer par numéro ».

### Premier vrai échange WhatsApp (7 novembre 2026, 05 h 55 UTC) et corrections du bot

Le bot répond sur le numéro de test (premier message à 01 h 55, heure de Guadeloupe). Corrections après les
tests de Jules :
1. **IA jamais appelée** : en mode « toujours », tout message sans session ni mot-clé lançait l'Accueil (flux
   par défaut). Désormais : salutation (« bonjour », « salut ça va », « bonswa »…) ou premier contact très court
   (≤ 2 mots, emoji) → Accueil ; tout autre message → l'IA, qui répond et peut lancer un flux (proposer_commande…) ;
   sans IA → Accueil comme avant.
2. **Accueil répété** : accueil complet seulement si le contact n'avait rien écrit depuis 12 h (variable
   `{{nouvelle_conversation}}`), sinon version courte « Que puis-je faire pour vous ? » (3 boutons : Commander,
   Me conseiller, Infos pratiques). « commander » retiré de l'Accueil, ajouté à « CTA - Commander » (avec « je
   commande », « passer commande », « passer une commande » ; pas « commande » seul, à cause de « ma commande est
   où ? »). Un mot-clé ne lance son flux que dans un message de 4 mots maximum ; au-delà, l'IA répond.
3. **Jours de livraison** : non enregistrés. `bot_fiches` est vide (aucune fiche bot, pour aucun resto) et le CRM
   (`qg_zones_livraison`) ne connaît que nom, frais et minimum des zones. Le code les lit bien quand ils existent
   (tests) : il faut les saisir dans la fiche de Cookies An Nou (PFlow Bots → Clients → Cookies An Nou → Fiche
   d'infos → Jours de livraison par zone).
4. **Prénom** : seulement si le profil WhatsApp est un seul mot de lettres (« Jules ») ; sinon « Hello ! ».
5. **Test d'accès** : `?fields=…` refusé sur le WABA du nouveau modèle (« Invalid parameter », sous-code 2388339) →
   lecture simple des deux comptes ; numéros et apps abonnées lus sur le compte qui répond.
Vérifié : 353 tests, et `scripts/e2e/accueil-ia.js` dans le simulateur (8 étapes vertes).

### C4 — PFlow Order branché (7 novembre 2026), en attente de Jules

- **Garde-fou absolu, double barrière** : PFlow Order n'appelle PFlow Bots que si `pflow_bots_canal_actif`
  (qg66) répond vrai — canal WhatsApp « actif » du resto dans `bot_canaux` ; PFlow Bots ne prend un
  événement réel que pour un canal « actif ». Canal « test » (Cookies An Nou aujourd'hui) : UChat, comme avant.
- Patches 01–05 et 07 rejoués sur `6ca596b` (dernière version de `main`), un commit chacun, + garde-fou 08.
  Branche `pflow-bots-c4` de Pflow-Crm, PR non fusionnée. Le 06 reste de côté.
- PFlow Bots : route `/api/webhooks/pflow-order`, bouton « Événement de commande de test » sur la page État
  (simulation signée vers le numéro de test, aucune commande créée). Interopérabilité de la signature vérifiée
  (signature du CRM acceptée par PFlow Bots).
- Pas encore gérés côté PFlow Bots : annulée, remboursée, annulation refusée, rappel (ignorés, expliqués).


## Nuit du 7 au 8 novembre 2026 — session autonome (8 tâches)

Règles : aucune écriture dans la base du CRM, rien chez Meta, aucune fusion ; Pflow-Crm : branches et PR
seulement. Écritures en base : **aucune** cette nuit (lectures seules pour vérifier les définitions).

1. **Production après la PR n° 74** : la PR n° 74 **n'est pas fusionnée** (GitHub : « open »). La production
   (`main`, `9e5e11e`) n'a donc rien reçu : rien ne casse. Vérifié : order.pflow.fr/c/cookies-an-nou répond.
   Si elle avait été fusionnée sans les SQL : rien de cassé côté clients (la page de commande lit
   `paiement_mode_public`, inchangée tant que le SQL n'est pas joué) ; seul le panneau Paiement de l'Atelier
   aurait proposé des réglages refusés par la base. **Aucun fichier existant écrasé** (que des ajouts).
2. **PR n° 76** (remplace la n° 74, à fermer sans fusion) : mêmes changements sur la dernière version de
   `main`, SQL renumérotés **qg85, qg86, qg87**. Les 9 points de greffe de qg85 vérifiés sur les définitions
   **en vigueur** en production (lecture seule, après qg84). Test : numéros uniques, après qg84. Suite du
   CRM : 905 passés, 1 échec déjà présent sur `main` (réels Instagram). Aperçu Vercel : Ready.
3. **Flux d'événements** : annulée (remboursée intégralement / en partie / sans paiement), remboursée,
   annulation refusée, rappel. Mêmes règles (24 h, envoyés même en pause). Le rappel n'est envoyé par
   PFlow Order que si le resto l'a réglé (option du CRM). Variables `remboursement`, `montant_rembourse`
   ajoutées côté CRM (PR n° 76).
4. **C5** : bloc « Commande » (suivi / annulation) + fonctions IA `suivre_commande`, `annuler_commande`,
   par le pont existant `/api/pont` (header `x-pflow-cle`). Annulation **toujours confirmée** (Oui / Non).
   Variable : **`PFLOW_ORDER_PONT_CLE`** (= `PONT_CLE` du CRM, à copier par Jules ; jamais lue par moi).
   Testé contre un faux pont ; simulateur : réponses d'exemple marquées « Simulation ».
5. **proposer_commande** après une recommandation ou un intérêt pour un produit : consigne et description
   par défaut. La consigne de la production est encore celle par défaut (empreinte vérifiée) : elle sera mise
   à jour par « Ajouter les flux manquants » (page Modèle), sans toucher un texte modifié.
   ⚠️ Le bloc IA du flux « IA - Recommandation » de la production a une instruction modifiée (« … puis
   propose de commander ») : la consigne suffit, mais tu peux y ajouter « Utilise proposer_commande ».
6. **plan.md** : ag_pizzaa (copie de l'Accueil) à relier au modèle avant sa bascule.
7. **C6** : `docs/etape-c/guide-c6-bascule.md` (diagnostic, test, bascule, retour arrière en 2 min, numéro
   PFlow Démo) + **page État → Canaux** : passer en actif / repasser en test / couper (confirmation ;
   **un numéro de test Meta +1 555 ne passe jamais en actif**), choix du canal pour l'événement de test.
   Coexistence d'un numéro pas encore sur l'API : Embedded Signup, pas codé (cas C du guide).
8. **Hébergement** : `docs/hebergement.md` → **Vercel Pro (20 $/mois)** recommandé, avant le premier canal
   actif (usage commercial, CRM compris ; fin de la limite de 12 fonctions).

Tests : PFlow Bots 372 (vitest) ; simulateur `accueil-ia.js`, `agent-ia.js`, `commande-c5.js` verts.

## À tester par Jules (à jour, 8 novembre 2026 — dans l'ordre)

| # | Où | Quoi faire | Résultat attendu | Durée |
|---|---|---|---|---|
| 1 | GitHub Pflow-Crm | **Fermer la PR n° 74 sans la fusionner** | Fermée | 1 min |
| 2 | Supabase → SQL Editor | Jouer `qg85-paiement-offre-de-base.sql`, puis `qg86-paiement-inclus.sql`, puis `qg87-pflow-bots-canal-actif.sql` (depuis la branche `pflow-bots-c4-v2`) | qg86 affiche `option_retiree: true, prix_a_zero: true` | 5 min |
| 3 | GitHub | Fusionner la **PR n° 76** | Vercel déploie order.pflow.fr | 2 min |
| 4 | order.pflow.fr | Mini-site Cookies An Nou, Atelier → panneau Paiement de Cookies, Dashboard d'un resto | S'ouvrent normalement ; plus de bouton « Option vendue » ni « +79 € » | 5 min |
| 5 | Vercel (2 projets) | `PFLOW_BOTS_URL` + `PFLOW_BOTS_SECRET` (si pas déjà fait) ; **`PFLOW_ORDER_PONT_CLE`** = valeur de `PONT_CLE` du CRM, projet pflow-bot-app ; Redeploy | Page État : clés « présente » | 5 min |
| 6 | PFlow Bots → **Modèle** | **Ajouter les flux manquants** | « Ajouté : Statut - Annulée, … IA - Suivre commande, IA - Annuler commande ; Agent IA : … » | 1 min |
| 7 | WhatsApp, numéro de test | « Bonjour », puis page État → **Événement de commande de test** : Annulée, Remboursée, Annulation refusée, Rappel | Les 4 messages arrivent | 4 min |
| 8 | WhatsApp, numéro de test | « elle arrive quand ma commande ? » puis « je veux annuler ma commande » → **Non** | Réponse de PFlow Order (ta dernière commande chez Cookies, ou « aucune commande ») ; « Non » ne touche à rien. ⚠️ Ne réponds « Oui » que si tu n'as **aucune vraie commande** en cours chez Cookies | 3 min |
| 9 | WhatsApp, numéro de test | « vous avez quoi au chocolat ? » | Recommandation puis bouton « Je commande » | 1 min |
| 10 | PFlow Bots → **État → Canaux** | Regarder la carte | Cookies An Nou (numéro de test) en « test » ; « Passer en actif » refusé (numéro de test Meta) | 1 min |
| 11 | Prochaine vraie commande Cookies | Rien à faire | Le client reçoit le message d'UChat comme avant (canal en test) | — |
| 12 | `docs/etape-c/guide-c6-bascule.md` | Faire le **diagnostic** (partie 1) du vrai numéro de Cookies et de PFlow Démo | Me dire le cas (A, B ou C) | 10 min |
| 13 | `docs/hebergement.md` | Lire, décider | Vercel Pro avant le premier canal actif | 3 min |


## 8 novembre 2026 — après les tests de Jules (tout OK sur le numéro de test)

- **Annulation sans commande** : le flux « IA - Annuler commande » vérifie d'abord (suivi du pont) qu'une
  commande peut être annulée. Aucune commande, déjà annulée, terminée ou prête → la raison tout de suite,
  sans confirmation. Sinon : « Vous voulez vraiment annuler votre commande n° 42 ? ». Modèle maître mis à
  jour en base (flux v2 ; la v1 n'avait pas été modifiée). Tests + simulateur verts.
- **Vercel Pro** : vérifié (équipe « Pflow » : pflow-crm, pflow-site-v7, pflow-bot-app ; journaux lisibles
  au-delà d'une heure). Mentions de la limite de 12 fonctions retirées (docs PFlow Bots ; CRM : PR n° 77).
- **Confidentialité** : un message pour un numéro sans canal (autre numéro du même compte WhatsApp, ex.
  numéro perso) n'est plus enregistré du tout.
- **Diagnostic C6** : `docs/etape-c/diagnostic-numeros.md` (écrans Meta + 5 requêtes de l'explorateur,
  lecture des cas A/B/C, ordre : PFlow Démo → Cookies An Nou → Mexico et ag pizza ; numéro perso jamais).


## 8 novembre 2026 — PFlow Démo : canal créé (accord de Jules)

1. **Canal PFlow Démo** : vérifié avant (lecture seule) qu'aucune ligne de `bot_canaux` n'existait avec
   `compte_id 1284474614757490` ou `messaging_account_id 4170754433058228` (ni ces WABA) → aucune. Insert appliqué
   tel que présenté : rôle `pflow`, `toujours`, coexistence, **état test** (seul 590690938108 reçoit des réponses),
   id `3c38356d-…`.
2. **Message d'un numéro hors liste sur un canal en test** (code, `src/channels/core/processor.ts`) :
   ligne 98 `claimEvent` enregistre l'événement brut (texte, numéro, nom de profil) dans
   `bot_webhook_evenements` (gardé 30 jours, visible masqué sur la page État) **avant** la vérification de la
   ligne 103 (« canal en test : numéro hors liste »), puis `finishEvent` y note la raison. **Pas** de contact
   (ligne 105, jamais atteinte), **pas** de message dans la boîte de réception (`bot_messages`), **pas** d'IA, ni
   d'alerte, ni d'envoi, ni d'accusé de lecture : **aucun coût**. Correctif en PR, sans fusion :
   https://github.com/julespauwels2-sudo/pflow-bot.app/pull/1 (canal en test, numéro hors liste, ou canal coupé →
   rien enregistré ; il reste une ligne de log sans numéro, qui sert de compteur). À fusionner avant
   « Abonner PFlow Bots ».
3. **Facturation** : étape bloquante ajoutée avant « Passer en actif » dans `bascule-pflow-demo.md` (payeur du
   compte de messagerie 4170754433058228 ; ligne de crédit Smart Link → pas d'actif).
4. **Démos « Gwada food » et « Gwada Smash Burger »** : elles n'ont **jamais tourné sur un vrai numéro**.
   Ce sont des lignes de `bot_demos` créées automatiquement par PFlow Bots le 7 novembre (04 h 32 UTC, statut
   « démo » dans le CRM), sur aucun canal (le canal PFlow n'existait pas). Aucun contact ni message côté PFlow
   Bots ; côté CRM : aucun événement du pont (UChat) pour ces restos, aucun lien de démo (`qg_demo_liens`),
   aucun rendez-vous de démo. Personne n'a écrit ; aucun dernier message. Sans lien de démo, leur bouton
   « Commander » n'apparaît pas (voulu).
5. **plan.md** : Smart Link reste pendant les bascules ; son retrait est la toute dernière étape, après l'arrêt
   complet d'UChat.


## 8 novembre 2026 — tests réels sur PFlow Démo : mot-clé de démo, démo permanente

1. **Problème 1 : « gwada food » ne lançait pas la démo.** Le mot-clé était bien reconnu (`src/demos/router.ts`),
   mais le resto Gwada food n'a **aucun bot publié** (pas de modèle relié, brouillon seulement) :
   `loadBotFromWorkspace` (`src/channels/core/bot-loader.ts`) renvoyait `null`, et `src/channels/core/processor.ts`
   (vers la ligne 152, `if (!bot)`) retombait sur le bot PFlow de base. Correctif : en démo, un resto sans flux
   publié prend le **modèle maître** (Accueil, IA) avec son nom ; sans lien de démo dans le CRM, pas de bouton
   « Commander » (voulu). Tests : nom en plusieurs mots, majuscules, accents, espaces, « Démo … », « Bonjour … ».
   PR sans fusion : https://github.com/julespauwels2-sudo/pflow-bot.app/pull/2
2. **Problème 2 : démo permanente.** Inventaire du CRM : la page de commande (`/demo/commande`) et le Dashboard
   (`/demo`) de démo existent déjà, en mémoire (aucun appel `/api/…` réel, faux Supabase), reliés par le
   navigateur. Le resto fictif n'a donc **besoin d'aucune ligne en base ni d'aucun SQL**. Resto choisi par
   Jules : **Mint Burger** (burgers au matcha). Proposition (parcours WhatsApp, carte de 7 produits, 2 options,
   palette matcha + PFlow, isolation, ce qui manque) : `docs/etape-c/demo-permanente.md`. **Rien de codé** avant
   l'accord de Jules.
3. **plan.md** : le passage en actif de PFlow Démo est bloqué tant que la démo permanente n'existe pas.


## 8 novembre 2026 — démo permanente validée, PR ouvertes ; IA en démo sans carte

1. **IA d'une démo sans bot publié (PR n° 2)** : vérifié dans le code. L'IA voit la fiche du resto lue dans le CRM
   (`src/data/supabase/crm.ts` : horaires, adresse, livraison, zones, **carte avec prix et options**) plus la fiche
   PFlow Bots. Gwada food n'a **ni carte, ni horaires, ni adresse**, ni fiche PFlow Bots ; la base de connaissances n'a
   donc pas de section « Carte ». Les règles PFlow interdisaient déjà d'inventer. Ajouté pour une démo **sans carte** :
   - règles de démo prioritaires dans le prompt (`demoRules`, avant la base, en cache) : aucun produit ni prix, même
     en exemple ; réponse « c'est une démo, la carte n'y est pas encore » ;
   - les réponses portent les boutons « Obtenir ma démo » et « Tester la démo », qui ramènent au bot PFlow ;
   - fonctions de commande retirées à l'IA ; bouton « Commander » sans page de démo remplacé par le même message ;
   - tests (prompt, route `/api/ai`, faux Meta de bout en bout).
   **Coût IA mesuré en production** (Haiku 5.5, 6 appels WhatsApp réels) : 0,0004 $ par réponse en moyenne,
   0,0007 $ au plus. Une conversation de démo (3 à 6 questions) : **0,001 à 0,004 $** ; plafond : 20 réponses IA par
   contact et par jour, soit **0,015 $ au plus** par prospect et par jour. Le bot PFlow de base et la démo
   permanente : aucune IA, **0 $**. (Hors coût Meta des messages, payé par la carte de Jules.)
2. **Démo permanente validée** (Mint Burger, carte, options et palette telles quelles ; logo simple ; photos plus
   tard, champ prévu ; les deux mécanismes du Dashboard). PR sans fusion :
   - CRM : https://github.com/julespauwels2-sudo/Pflow-Crm/pull/79 (aucun SQL) ;
   - PFlow Bots : https://github.com/julespauwels2-sudo/pflow-bot.app/pull/3 (à fusionner après la n° 2).
3. **Facturation de PFlow Démo réglée** (carte de Jules) : retirée des blocages. Seul blocage restant pour passer
   PFlow Démo en actif : la démo permanente.


## 8 novembre 2026 (suite) — PR n° 2 : valeurs par défaut du CRM, SQL des numéros de test

1. **PR n° 2** : pour une démo sans carte **ni fiche remplie** (aucun champ saisi à la main dans PFlow Bots), les
   champs du CRM (livraison non / retrait oui, horaires, zones, adresse, paiement) ne sont que des valeurs par
   défaut : l'IA ne les reçoit plus (fiche vide), et répond « c'est une démo, ces infos ne sont pas encore
   renseignées », avec les deux boutons. Tests ajoutés. La branche de la PR n° 3 a été mise à jour avec ce
   changement (aucun conflit à prévoir à la fusion).
2. **SQL préparé, non appliqué** : 2 numéros de test de plus sur le canal PFlow Démo (emplacements `<NUMERO_1>`,
   `<NUMERO_2>`), dans `docs/etape-c/bascule-pflow-demo.md`.
3. **Ordre de fusion de Jules** : CRM n° 79, puis PFlow Bots n° 2, puis n° 3. Fusion classique (pas « squash »).
4. **plan.md** : le test `sons-tendance.test.js` du CRM, en échec sur `main`, noté à traiter plus tard.


## 8 novembre 2026 (soir) — numéros de test, Infos pratiques en démo vide, Mint Bun

1. **SQL appliqué** (accord de Jules) sur le canal PFlow Démo `3c38356d-1947-4462-95a8-8df1b400254e` :
   `returning` → état `test`, `test_numeros = {590690635359, 590690748247, 590690938108}`.
2. **PR n° 2 de PFlow Bots : encore ouverte** sur GitHub au moment du travail (Jules pensait l'avoir fusionnée ;
   la PR CRM n° 79, elle, est fusionnée). La n° 3 la contient déjà : rien de bloquant. À fusionner : n° 2 puis n° 3.
3. **PR n° 3 mise à jour** :
   - branche remise à jour avec la base ;
   - flux « Infos pratiques » (et tout flux qui affiche des infos de la fiche) : dans une démo sans carte ni fiche,
     « C'est une démo : ces infos ne sont pas encore renseignées. » avec les deux boutons, au lieu des valeurs par
     défaut du CRM ; test ;
   - Mint Burger devient Mint Bun dans les textes. 387 tests passent.
4. **PR CRM n° 80 : Mint Bun** (smash burgers & matcha) :
   - carte du menu (19 produits) ; suppléments steak et cheddar ; formules à prix fixe avec groupes de choix ;
   - nouvelle palette (cadre PFlow gardé) ; aucun « ® » ; dossier `img/demo/mint-bun` ;
   - tests navigateur 11/11.
   - **`mint-bun-assets.zip` pas reçu** : logo provisoire (SVG) et tuiles en attendant ; logo, photos (webp) et palette
     finale à ajouter dans la même PR dès réception.


## 8 novembre 2026 (fin de journée) — PR n° 3 à jour, Mint Bun complet

1. **PR n° 2** : fusionnée par Jules en **merge normal** (commit `d31578d`, deux parents ; `claude/demo-sans-bot` est un
   ancêtre de la base).
2. **PR n° 3** : GitHub la signalait en conflit (4 fichiers). La base y a été fusionnée **sans aucun conflit réel** :
   la branche contenait déjà le dernier commit de la n° 2 (`0e91a8e`), la base n'apportait que de la documentation
   (l'état « en conflit » venait de l'ancienne base, avant la fusion de la n° 2). Les deux séries de changements sont
   présentes (démo sans carte / fiche vide ; démo permanente, Infos pratiques, Mint Bun). 387 tests, lint et build OK.
3. **PR CRM n° 80** : zip reçu. Logo sans « ® » (webp carré + complet), 9 photos en webp (136 Ko pour tout le dossier,
   proportions gardées ; Mint Classic = grand visuel ; cookie-brookie coupée en deux), palette relevée sur le menu
   (`#0E2F1C`, `#DFE7B5`, `#FAF6E8`, `#FCE5DD`). Tests navigateur 11/11 (dont « aucune image cassée »).


## 8 novembre 2026 (soir) — parcours guidé du numéro PFlow Démo

Retour de test de Jules : la démo permanente marche, mais l'accueil est trop chargé. Nouveau parcours, un seul chemin :
- **Accueil** : un message, un bouton [Tester la démo].
- **Étape 1/3** : [Je commande].
- **Retour « J'ai passé ma commande ✅ »**, puis **étape 2/3** : [Voir le dashboard].
- **Retour « J'ai vu le dashboard 👀 »**, puis **étape 3/3** : [Je veux le mien] [Comment ça marche ?].

Détail dans `docs/etape-c/demo-permanente.md` (partie 0 ter).
- **PFlow Bots n° 4** : flux du bot PFlow de base réécrits, et `src/demos/parcours.ts`.
  - L'étape est gardée avec le contact.
  - Un mot-clé lance son étape. Tout autre message rappelle l'étape avec son bouton et [✅ C'est fait] ; « c'est fait » écrit fait avancer.
  - Pas de relance automatique ; oubli après 7 jours. Plus de transfert à Jules sur un message libre.
  - Même logique dans le simulateur. 388 tests.
- **CRM n° 81** (part de la n° 80) : boutons « Retour sur WhatsApp ».
  - wa.me/590691266853 avec le texte prérempli, sur la confirmation et sur le dashboard de démo.
  - Correctif : faux « Votre offre PFlow a été mise à jour » sur le dashboard de démo (deux variables `OFFRE` du même nom).
  - Tests navigateur : 11 sur 11.
- **wa.me depuis le navigateur intégré de WhatsApp** : pas de documentation officielle ; des retours d'éditeurs signalent des liens qui restent sur la page web de wa.me (« Continuer vers la discussion ») ou qui perdent le texte prérempli. Le secours est codé (rappel + [✅ C'est fait]). À tester sur iPhone et Android.


## 8 novembre 2026 (soir, suite) — joindre Jules en plein parcours (PR n° 4)

- **[💬 Parler à Jules]** dans chaque rappel d'étape (1, 2, 3) : transfert à Jules avec alerte, « Pas de souci, Jules
  vous répond très vite 🙂 » (comme « Je veux le mien » : bot en pause pour ce contact).
- **Question en plein parcours** (« ? » ou plus de 4 mots) : « Bonne question ! Jules vous répond très vite 🙂 »,
  alerte WhatsApp + boîte de réception (avec la question), rappel de l'étape, **sans pause**. Une alerte au plus par
  contact toutes les 30 min. Source du transfert : `bloc` (sources fixées en base par `bot_transferts_source_check` ;
  aucune migration).
- 392 tests. **PFlow Bots n° 3 : fusionnée** ; la n° 4 en dépend, plus rien ne bloque.
- Ordre de fusion : CRM n° 80 → CRM n° 81 → PFlow Bots n° 4.


## 9 novembre 2026 — démo permanente automatique (PR PFlow Bots n° 5, CRM n° 82)

Retour de test de Jules : le parcours guidé marche ; il faut qu'il avance sans que le prospect écrive.
- **Confirmation automatique** :
  - la page Mint Bun, ouverte par le lien du bot (jeton `?j=`), envoie la commande validée à PFlow Bots (`POST /api/demo/commande`) ;
  - le prospect reçoit « Commande enregistrée » (numéro, récap, options, total, paiement sur place, « commande de démo, rien n'est préparé »), puis l'étape 2/3.
- **Étape 3 automatique** :
  - le lien [Voir le dashboard] passe par `/api/demo/dashboard/<jeton>`, qui note l'ouverture, programme l'étape 3 (90 s, réglable) et redirige vers le dashboard avec la commande après le # ;
  - la tâche Vercel à la minute (`/api/cron/demo`) l'envoie, même onglet fermé.
- **Garde-fous** :
  - jeton chiffré, propre au contact, 24 h ;
  - 3 confirmations par heure au plus ; une commande confirmée une seule fois ;
  - rien si le contact est en pause ; l'étape 3 jamais deux fois ; canal en test respecté ;
  - textes nettoyés ; aucun Stripe ni PFlow Order. **Aucun SQL**.
- **Secours conservés** : « Retour sur WhatsApp » en lien discret (principal si l'envoi échoue), et le rappel [✅ C'est fait].
- **Tests** : PFlow Bots 399 (faux Meta, de bout en bout) ; CRM 15/15 en navigateur (dont le format exact de la commande, accepté des deux côtés).
- **Variables Vercel vérifiées** (noms seulement) : `PFLOW_BOTS_SECRET` et `CRON_SECRET` présents en production. Facultatives : `PFLOW_DEMO_ETAPE3_SECONDES`, `PFLOW_BOTS_PUBLIC_URL`, `PFLOW_DEMO_ORIGINES`.


## 9 novembre 2026 — alertes à Jules (PR PFlow Bots n° 6)

- **État des fusions** :
  - CRM n° 80 et n° 81 : fusionnées.
  - CRM n° 82 : ouverte, construite sur `main` à jour.
  - PFlow Bots n° 4 : fusionnée.
  - PFlow Bots n° 5 : ouverte, construite sur la base après la n° 4.
  - PFlow Bots n° 6 : ouverte, construite sur la branche de la n° 5.
- **Avant** : alertes en message libre depuis le numéro du canal (PFlow Démo) vers 590690938108, refusées par Meta hors
  fenêtre de 24 h (cas normal en production) ; personne n'était prévenu.
- **Après** :
  - message libre si la fenêtre est ouverte ;
  - sinon modèle utilitaire approuvé `alerte_conversation` (à créer par Jules ; texte, catégorie, coût ≈ 0,025-0,03 € et étapes dans `docs/etape-c/alertes-jules.md`) ;
  - sinon e-mail de secours (Resend, à créer).
  - Voie et erreurs gardées avec le transfert, page État « Alertes au gérant ».
- **SQL** (2 colonnes sur `bot_transferts`) fourni, **non appliqué** ; le code fonctionne sans.
- **Tests** : 405. **Rien de créé chez Meta ni chez Resend.**


## 9 novembre 2026 — notifications push de la boîte de réception (PR séparée, sur la n° 6)

- **App installable** (`src/app/manifest.ts`, icônes, `public/sw.js`) : écran d'accueil de l'iPhone, ouverture directe
  sur `/inbox`.
- **Web Push standard** (bibliothèque `web-push` 3.6.7, clés VAPID dans Vercel ; aucun service payant).
  - Bouton « Activer les notifications » : boîte de réception et page État.
  - Abonnements dans `bot_push_abonnements` (SQL montré, **non appliqué**).
  - Notification : motif, contact, extrait. Toucher ouvre la conversation.
- **Ordre des alertes** : WhatsApp et push **en parallèle**. E-mail **seulement si les deux échouent**.
- **Page État** : appareils abonnés, voie push de chaque alerte, « Envoyer une notification de test ».
- iPhone : iOS 16.4+, app ajoutée à l'écran d'accueil, autorisation après un toucher. Étapes exactes dans
  `docs/etape-c/notifications-push.md`.
- 420 tests, dont un qui **déchiffre** la vraie notification chiffrée comme le ferait l'iPhone.
- Au passage :
  - menu lisible sur téléphone ;
  - après connexion, retour à la page demandée avec ses paramètres (`?contact=`) ;
  - `safeNext` refuse aussi `/\…` (redirection vers un autre site).


## 9 novembre 2026 (suite) — alertes : notification push seulement (PR n° 7)

- **SQL push appliqué** (accord de Jules) : `bot_push_abonnements` (RLS active) et `bot_transferts.alerte_push`.
- **Changement de stratégie** (pas de frais, pas d'e-mail) : la seule voie d'alerte du chatbot est la notification
  push.
  - Retirés du code : alerte WhatsApp vers `tel_alerte` (message libre et modèle Meta, `sendTemplate`) et e-mail
    Resend.
  - Variables plus utilisées : `WHATSAPP_ALERTE_MODELE`, `RESEND_API_KEY`, `ALERTE_EMAIL`…
- Sans appareil ou en cas d'échec :
  - la conversation reste « 🔔 Attend l'équipe » dans la boîte de réception ;
  - **bandeau rouge** en haut de la page État (alertes non reçues, aucun appareil abonné, clés absentes).
- `VAPID_SUBJECT` facultatif : par défaut `PFLOW_BOTS_PUBLIC_URL`, sinon `https://pflow-bot-app.vercel.app`.
- **Aucune contrainte SQL à changer** : `alerte_voie` n'est plus écrite (historique), la voie se déduit de
  `alerte_push`.
- Plan, « Plus tard » : notifications push pour le CRM (chantier séparé).


## 9 novembre 2026 (suite) — version mobile (PR séparée)

Retour de test de Jules : sur iPhone, PFlow Bots était inutilisable (dimensions, boîte de réception
incompréhensible). Version mobile en dessous de 768 px, ordinateur inchangé (`docs/etape-c/mobile.md`) :
- **boîte de réception façon WhatsApp** :
  - liste en plein écran, celles qui attendent Jules en haut, non lus en gras ;
  - conversation en plein écran, flèche retour, zone de réponse au-dessus du clavier iOS, boutons de 44 px ;
  - une notification ouvre directement la conversation ;
- **barre d'onglets** (Boîte de réception, État) avec les zones sûres ;
- **État** en une colonne ;
- **autres pages** : « Cette page s'utilise sur ordinateur » ;
- champs 16 px, boutons 44 px, aucun défilement horizontal (vérifié à 390 × 844, mode app installée).
- Mode démo : `/api/inbox/simuler` accepte un canal (`canal-pflow`) pour simuler le numéro PFlow.


## 9 novembre 2026 (suite) — migration des 3 clients (19-21) et nouveau client : vérifications en lecture seule

- **Runbook** : `docs/etape-c/migration-3-clients.md`.
  - Bots des 3 restos liés au modèle maître.
  - Liens de commande en ligne, cartes et horaires présents.
  - **Fiches du bot vides** (à remplir).
  - IDs Meta inconnus de mon côté : diagnostic à faire par Jules avant le 12.
  - SQL des 3 canaux en test préparé, **non appliqué**.
  - Runbooks cochables du 19 au 21, avec retour arrière.
- **Risque à l'arrêt d'UChat** : surtout le **moyen de paiement** (ligne de crédit Smart Link révocable). À
  vérifier et remplacer par la carte de Jules avant le 12.
  - Ne jamais « De-register » dans UChat ; ne pas retirer Smart Link.
  - Coexistence : appli à ouvrir au moins tous les 13 à 14 jours.
- **ag pizza** : sa copie de l'Accueil n'a aucune personnalisation (textes et boutons identiques au modèle) :
  « Revenir au modèle » le 19 (SQL équivalent montré, non appliqué).
- **Nouveau client** : `docs/etape-c/nouveau-client.md`.
  - Sans UChat, le numéro d'un resto ne peut plus être mis sur l'API en gardant son appli : il faut l'Embedded
    Signup v4 (statut Tech Provider).
  - Démarches Meta à lancer maintenant (1 à 3 semaines), développement ≈ 4 à 5 jours après le 21.


## 9 novembre 2026 (suite) — messages vocaux : Groq, limites, réponses claires (PR séparée)

- **Comparatif** (tarifs du 9 novembre 2026) : Groq 0,04 $ / h, contre ≈ 0,003 $ / min pour OpenAI et Mistral.
  **Groq retenu** : le moins cher (≈ 0,07 $ / mois pour 300 vocaux de 20 s) et le plus rapide. Aucun service ne
  connaît le créole guadeloupéen : à tester sur de vrais vocaux. Détail : `docs/etape-c/vocaux.md`.
- **Une seule variable** : `TRANSCRIPTION_API_KEY` (Groq par défaut).
- **Limites** : 2 min au plus, 10 vocaux transcrits par contact sur 24 h. Au-delà, ou en cas d'échec, le bot
  demande d'écrire (« Je n'ai pas bien compris votre vocal, pouvez-vous l'écrire ? »).
- **Boîte de réception** : « 🎤 Message vocal (0:23) » et la transcription.
- **Aucun fichier audio stocké.**


## 9 novembre 2026 (soir) — PFlow Démo actif ; diagnostic, boutons, étape 3, notification du CRM

- **PFlow Démo est passé en ACTIF** (bot UChat de ce numéro désactivé). Un testeur a fait tout le parcours (commande,
  confirmation automatique, dashboard, étape 3, « Je veux le mien ») ; Jules a reçu la notification push.
- **Premier message du testeur, avant l'actif** :
  - les journaux de Vercel montrent **7 messages ignorés** entre 04:34:16 et 04:35:06 (UTC) : « canal en test, numéro
    hors liste : rien enregistré » ;
  - le canal est passé en actif à 04:37:33 ;
  - à 04:39:23, un nouveau contact se crée, **numéro finissant par 3646**, hors de la liste de test.
  - Les journaux n'ont pas le numéro (voulu) : c'est très probablement lui, mais non prouvé.
- **Désormais**, un message ignoré « hors liste » laisse une trace avec **les 4 derniers chiffres seulement**
  (page État ; ni le message, ni le numéro, ni l'identifiant du message ; 30 jours).
- **Page État, « Diagnostic des comptes WhatsApp »** (lecture seule chez Meta) : comptes attribués au token, numéros,
  qualité, statut, coexistence, apps abonnées, et SQL des canaux en test proposé pour les numéros sans canal.
- PR séparées : vrais boutons WhatsApp dans la boîte de réception ; étape 3 en ≈ 20 s ; CRM : notification
  « commande prête » en bas de l'écran.


## 9 novembre 2026 (nuit) — audit des notifications du CRM (lecture seule, aucun code)

- **Seul canal vers Jules : le push de l'app QG du CRM** (marche, indépendant de Vercel et d'UChat). WhatsApp coupé
  depuis le 26 octobre (code + pause jusqu'en 2100 en base). Ni e-mail, ni SMS.
- 🔴 **Commande non acceptée** : détectée (10 min, 12 fois en 30 jours, dont Cookies An Nou 6 h 19 le 8 nov. et Mexico
  plus d'1 jour le 1er nov.) mais **Jules n'est plus prévenu** : la règle n'est pas dans la liste du push.
  Correctif d'1 ligne proposé (réglage `qg_settings.alertes_push`), **non appliqué**.
- **Resto sans commande depuis X jours** : n'existe pas en jours (silence en heures, décrochage à la semaine,
  affichage seulement).
- **Résumé du matin** : push chaque jour à 8 h, marche.
- **Stripe** (abonnement PFlow) : branché, push en temps réel, jamais déclenché (aucune facture d'abonnement).
- Appareils abonnés au push du QG : 1 seul (5 fin octobre).
- Recommandation : pas de nouveau push dans le CRM ; à terme, **PFlow Bots centre d'alertes unique** pour tout ce qui
  touche un resto (lecture de la table `alertes`, aucune modification du CRM). Détail :
  `docs/etape-c/audit-notifications-crm.md`.

