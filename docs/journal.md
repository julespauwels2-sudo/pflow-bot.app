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

## À tester par Jules (classé par priorité, chaque point < 5 min)

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
