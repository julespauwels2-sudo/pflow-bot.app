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
