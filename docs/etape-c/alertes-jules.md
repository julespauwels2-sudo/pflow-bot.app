# Alertes à Jules (et aux gérants) : notification push uniquement

Mis à jour le 9 novembre 2026 : **changement de stratégie décidé par Jules** (pas de frais, pas d'e-mail).
Détail technique des notifications : `docs/etape-c/notifications-push.md`.

## 1. La règle

Quand un client attend une réponse (« Je veux le mien », « Parler à Jules », question en plein parcours, transfert de
l'assistant), **la seule alerte est une notification push** sur les appareils abonnés : iPhone avec l'app installée,
ordinateur. Toucher la notification ouvre la conversation.

**Retiré** (code supprimé, plus aucun envoi) :
- **message WhatsApp** de PFlow Démo (ou du numéro d'un resto) vers le numéro d'alerte (`tel_alerte`) : ni message
  libre, ni modèle Meta ;
- **modèle de message Meta** `alerte_conversation` : à ne pas créer. L'envoi de modèles (`sendTemplate`) a été retiré
  du code ;
- **e-mail de secours** (Resend) : pas de compte à créer, plus aucun appel à Resend.

La colonne `tel_alerte` de `bot_canaux` reste en base (rien n'est supprimé), mais le code ne l'utilise plus.

## 2. Si personne n'est prévenu

Cas possibles : aucun appareil abonné, notifications désactivées, push en échec, clés VAPID absentes. L'alerte n'est
pas perdue :
- **boîte de réception** : la conversation reste marquée **« 🔔 Attend l'équipe »** tant que le transfert est ouvert ;
- **page État** : **bandeau rouge** en haut de la page, « 🚨 Alertes : personne n'est prévenu ». Il s'affiche dans
  trois cas :
  - des alertes récentes non reçues (combien, et combien de clients attendent peut-être encore) ;
  - aucun appareil abonné ;
  - clés VAPID absentes.
- encadré **« Alertes au gérant »** : chaque alerte avec sa voie (**notification push** ou **NON REÇUE**), la raison
  (aucun appareil abonné, push en échec, push non configurée) et « à traiter dans la boîte de réception ».

Les anciennes alertes (avant ce changement) gardent leur voie d'origine dans la liste : « WhatsApp (ancienne voie) »,
etc.

## 3. Ce que le code enregistre

`src/channels/core/alerts.ts` → `sendAlert` : envoi push, puis enregistrement avec le transfert :
- `gerant_prevenu` : vrai seulement si au moins un appareil a reçu la notification ;
- `alerte_push` : `envoyee`, `echec`, `aucun_abonnement` ou `non_configure` ;
- `alerte_erreur` : la raison, en cas d'échec.

`alerte_voie` n'est plus écrite : elle garde l'historique des anciennes alertes. La voie affichée se déduit de
`alerte_push` (push ou aucune).

## 4. SQL

**Aucune contrainte à changer.** Les colonnes existantes suffisent :
- `alerte_voie`, `alerte_erreur` : appliquées le 9 novembre 2026 ;
- `alerte_push` et la table `bot_push_abonnements` : appliquées le 9 novembre 2026, voir
  `docs/etape-c/notifications-push.md`.

La contrainte `bot_transferts_alerte_voie_check` (`texte`, `modele`, `email`, `aucune`) reste telle quelle pour
l'historique. On n'y ajoute pas `push` puisque la colonne n'est plus écrite.

## 5. Variables Vercel (pflow-bot-app)

| Variable | Rôle | État |
|---|---|---|
| `VAPID_PUBLIC_KEY` | clé publique des notifications | à ajouter (voir `notifications-push.md`, partie 4) |
| `VAPID_PRIVATE_KEY` | clé privée des notifications | à ajouter, **Sensitive** |
| `VAPID_SUBJECT` | contact VAPID | **facultatif** : par défaut `PFLOW_BOTS_PUBLIC_URL`, sinon `https://pflow-bot-app.vercel.app` |

Plus utilisées (à ne pas créer) : `WHATSAPP_ALERTE_MODELE`, `WHATSAPP_ALERTE_LANGUE`, `RESEND_API_KEY`,
`ALERTE_EMAIL`, `ALERTE_EMAIL_FROM`.

## 6. Avant de passer PFlow Démo en actif

1. Clés VAPID dans Vercel, puis redéploiement.
2. Sur l'iPhone de Jules : app installée, notifications activées (étapes dans `notifications-push.md`, partie 3).
3. Page État → « Envoyer une notification de test » : reçue.
4. Pas de bandeau rouge sur la page État.

## 7. Tests

`src/channels/core/__tests__/alerts.test.ts` :
- configuration : les anciennes variables (modèle Meta, Resend) sont ignorées ;
- un appareil abonné : notification envoyée, voie « push » ;
- aucun appareil, clés absentes ou push en échec : « aucune », avec la raison ; **aucun appel réseau** (ni Meta, ni
  Resend) ;
- de bout en bout (faux Meta) :
  - **même si Jules vient d'écrire au numéro** (fenêtre de 24 h ouverte), rien ne part vers son numéro ;
  - la notification ouvre la conversation ;
  - sans appareil, l'alerte est « non reçue » mais la conversation reste « 🔔 Attend l'équipe » dans la boîte de
    réception.

`src/demos/__tests__/pflow-number.test.ts` : dans le parcours de démo, les alertes « Je veux le mien », « Parler à
Jules » et « Question » arrivent en notification ; jamais de message vers le numéro de Jules.
