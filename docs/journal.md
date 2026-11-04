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
