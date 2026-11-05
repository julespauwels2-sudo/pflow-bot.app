# Audit de sécurité — PFlow Bots

**Fait le 5 novembre 2026** (session autonome, tâche 8), sur la branche `claude/kind-curie-4xtkln`.
Règle suivie : corriger ce qui se corrige **sans migration** ; lister le reste avec une proposition.
Aucune écriture dans la base : les vérifications Supabase ont été faites en **lecture seule**
(conseiller de sécurité de Supabase et lecture du catalogue).

## Résumé

| Domaine | État | Corrigé aujourd'hui |
|---|---|---|
| Accès aux pages | ✅ protégé | — |
| Accès aux routes API | ✅ protégé | limites de débit ajoutées |
| RLS des tables `bot_` | ✅ 8/8 tables avec RLS, aucune lecture anonyme | — |
| Secrets | ✅ aucun secret dans Git (historique complet vérifié) | `.env.example` complété |
| Webhooks | ✅ signature obligatoire, taille et débit limités | — |
| Données personnelles dans les journaux | ✅ numéros masqués, aucun message en clair | — |
| En-têtes de sécurité du navigateur | ⚠️ absents | ✅ ajoutés |
| Purge des messages après 12 mois | ⚠️ manquante | ✅ préparée, **non activée** |

## 1. Accès aux pages

- **Mot de passe provisoire** (`src/proxy.ts`) : si `BASIC_AUTH_PASSWORD` est défini, tout le site le
  demande (comparaison en temps constant), sauf `/api/webhooks/*` (Meta doit pouvoir appeler).
  En production sans mot de passe **et** sans Supabase, le site refuse tout (503).
- **Connexion Supabase** (`src/components/auth-gate.tsx`) : aucune page ne s'affiche avant la
  connexion ; seul un compte présent dans `bot_admins` voit des données (RLS).
- Les pages ne contiennent aucune donnée dans leur HTML : tout est chargé après connexion, à travers
  le RLS. La vraie barrière est donc le RLS et la vérification des routes, pas l'affichage.
- Vérifié : `/clients` et `/api/etat` sans mot de passe → 401.

## 2. Routes API

| Route | Qui peut l'appeler | Limite de débit |
|---|---|---|
| `POST /api/ai` | admin du bot (jeton Supabase vérifié côté serveur) | **30 / min / compte** (ajouté) |
| `GET /api/ai` | tout utilisateur passé par le proxy ; dit seulement si la clé existe et le modèle | — |
| `/api/inbox`, `/api/inbox/[id]` | admin du bot | **120 / min / compte** (ajouté) |
| `POST /api/inbox/simuler` | admin du bot, **mode démo uniquement** (refusé avec le vrai stockage) | idem |
| `GET /api/etat` | admin du bot ; jamais la valeur d'une clé (test automatique) | — |
| `GET/POST /api/webhooks/whatsapp`, `/instagram` | Meta : phrase de vérification (GET), **signature HMAC obligatoire** (POST) | 600 / min / adresse, corps ≤ 512 Ko |

Autres protections en place : modèles IA limités à la liste de l'app, textes limités (zod), un message
renvoyé par Meta n'est jamais traité deux fois, téléchargement des vocaux en https seulement et jamais
vers une adresse interne, plafond 10 Mo.

## 3. RLS (base Supabase, lecture seule)

- Les 8 tables créées par `bot_init` (`bot_admins`, `bot_appels_ia`, `bot_clients`, `bot_dossiers`,
  `bot_fiches`, `bot_flux`, `bot_modeles`, `bot_tournees`) : **RLS activé, une règle chacune, aucune
  lecture par le rôle `anon`**. Le conseiller de Supabase ne signale **rien** sur ces tables.
- Les tables de la migration C (non appliquée) ont toutes le RLS et sont fermées à `anon`.
- Le code refuse d'écrire ailleurs que dans les tables `bot_` du bot (`assertBotTable`), et refuse
  `bot_reglages` / `bot_cles` (tables du CRM qui commencent aussi par `bot_`).

**Signalé par Supabase, mais côté CRM** (pas touché ; analyse détaillée et SQL proposé dans
[securite-crm.md](securite-crm.md)) :
- 1 vue `vitrine` en *security definer* (niveau « erreur » pour Supabase) ;
- 141 fonctions *security definer* appelables par `anon` (dont les `bot_*` du pont PFlow Order,
  protégées par une clé passée en paramètre — à confirmer que c'est voulu) ;
- 117 fonctions sans `search_path` fixé, l'extension `pg_net` dans `public` ;
- 6 tables avec RLS mais sans règle (donc fermées : c'est sûr) ;
- **protection contre les mots de passe divulgués désactivée** (réglage Auth de Supabase, dans les
  réglages du fournisseur « Email » ; ⚠️ réservé aux offres payantes de Supabase d'après leur
  documentation, à vérifier). C'est un réglage de tout le projet (CRM compris) : à toi de décider.

## 4. Secrets

- Historique Git complet parcouru : aucune clé (Anthropic, Supabase secrète, token Meta, JWT). Seuls
  de faux exemples dans les tests. Les fichiers `.env*` sont ignorés (sauf `.env.example`, vide).
- La clé publique Supabase (*publishable*) est publique par conception ; elle n'est que dans
  `.env.local` et Vercel.
- `SUPABASE_SERVICE_ROLE_KEY` n'est lue que dans du code serveur (`src/channels/core/runtime.ts`,
  `src/lib/system-status.ts` pour sa présence).
- `.env.example` liste maintenant toutes les variables (WhatsApp, Instagram, vocaux, secret PFlow Order).

## 5. Données personnelles

- **Journaux** : seules les erreurs des webhooks sont écrites (`console.error`), numéros et
  identifiants masqués (`5906•••56`), jamais le texte des messages. Test automatique.
- **Base** : numéros, messages, transcriptions des vocaux, accessibles aux seuls admins. L'audio des
  vocaux n'est jamais stocké. Les messages envoyés à l'IA sont gardés dans `bot_appels_ia.message`.
- **Purge après 12 mois** : `src/channels/core/retention.ts` (préparée, testée, **non activée** : rien
  ne l'appelle, et même appelée elle ne supprime rien sans `PURGE_ACTIVE=oui`). Pour l'activer plus
  tard : une tâche planifiée Vercel (Cron) qui l'appelle une fois par jour.
- SQL équivalent, **à ne lancer qu'après ton accord** (pour mémoire) :

```sql
-- Messages des conversations : 12 mois.
delete from public.bot_messages where cree_le < now() - interval '12 months';
-- Événements bruts des webhooks (contiennent les messages) : 30 jours.
delete from public.bot_webhook_evenements where recu_le < now() - interval '30 days';
-- Messages envoyés à l'IA : 12 mois.
delete from public.bot_appels_ia where cree_le < now() - interval '12 months';
```

## 6. Corrigé aujourd'hui (sans migration)

1. **En-têtes de sécurité** sur tout le site (`next.config.ts`) : interdiction d'afficher le site dans
   un cadre (clickjacking), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS ; en-tête
   `X-Powered-By` retiré.
2. **Limites de débit** sur la route IA (30 / min / compte : chaque appel coûte) et la boîte de
   réception (120 / min / compte).
3. **Purge préparée** (ci-dessus) et testée.
4. `.env.example` complet.

## 7. Reste à faire (classé par priorité)

| # | Point | Pourquoi | Proposition |
|---|---|---|---|
| 1 | Activer la purge (12 mois / 30 jours) | RGPD : ne pas garder les conversations sans fin | Vercel Cron quotidien + `PURGE_ACTIVE=oui`, après la migration C |
| 2 | Politique de confidentialité publique | Obligatoire pour la validation Meta (WhatsApp et Instagram) et le RGPD | Page sur pflow.fr : données gardées, durée, finalité, contact |
| 3 | Accord de traitement avec chaque resto | PFlow traite les données des clients du resto (sous-traitant RGPD) | Une clause dans le contrat client |
| 4 | Limite de débit partagée entre serveurs | Sur Vercel, chaque instance a son compteur | Règle « rate limit » du pare-feu Vercel sur `/api/webhooks/*` et `/api/ai` |
| 5 | Content-Security-Policy complète | Défense en plus contre l'injection de scripts (React échappe déjà tout) | CSP avec *nonces* (Next.js), à tester page par page |
| 6 | Protection mots de passe divulgués (Supabase Auth) | Comptes admin | Réglage Supabase (offre payante, touche aussi le CRM) ; en attendant, mot de passe long et unique |
| 7 | Renouvellement du token Instagram (60 jours) | Sinon Instagram s'arrête | Rappel ou renouvellement automatique, avant le premier client Instagram |
| 8 | Points CRM signalés par Supabase (§ 3) | Hors du bot | À revoir côté PFlow Order, séparément |
