# Étape C — plan détaillé (WhatsApp)

**Préparé, non commencé.** Rien n'est appliqué ni branché avant la validation de Jules, sous-étape par
sous-étape, comme pour A et B.

## Objectif

Le bot d'un resto répond sur WhatsApp (API WhatsApp Cloud de Meta), avec exactement le moteur, les flux,
l'agent IA et la fiche testés dans le simulateur. PFlow Order prévient le bot des événements de commande.
Le gérant voit les conversations et reprend la main depuis une boîte de réception.

## Ce qui existe déjà (et sert tel quel)

- **Moteur** (`src/engine`) : pur, déjà testé avec les messages WhatsApp (texte, boutons, listes, écho du
  gérant, médias non gérés, événements de commande, fenêtre de 24 h, pauses, sessions).
- **Bot assemblé** (`resolveBot`) : modèle maître + flux du client + options.
- **Agent IA** (`src/ai`, `/api/ai`) : côté serveur, garde-fous (liens, salutations), coût suivi.
- **Données** (étape B) : tables `bot_`, CRM lu en lecture seule, garde-fou qui refuse toute écriture hors
  `bot_`.
- **Côté PFlow Order** (lu dans le dépôt `Pflow-Crm`) : un point unique qui envoie tous les événements de
  commande au bot (`api/_bot.js`, fonction `synchroniser()`), la relance des paniers abandonnés après
  20 min (réglable de 10 à 180 min, `api/_options.js`), le lien de reprise du panier, le bouton WhatsApp de
  la page de confirmation, et le « pont » (`api/pont.js`) qui sait déjà **suivre** et **annuler** une
  commande. Voir [pflow-order.md](pflow-order.md).

## Architecture

```
WhatsApp (Meta) ──webhook──▶ /api/webhooks/whatsapp ──▶ src/channels/whatsapp ──▶ moteur ──▶ envoi Graph API
                               (signature vérifiée,       (lecture du canal, du
                                réponse 200 immédiate)     contact, de la session)
PFlow Order ──événement signé──▶ /api/webhooks/pflow-order ──▶ même chemin (message « event »)
Boîte de réception (navigateur, connecté) ◀── bot_messages / bot_transferts
```

- **Webhook isolé** dans `src/channels/whatsapp/` (aucune dépendance à Next.js dans la logique) : il pourra
  être déplacé ailleurs (Supabase Edge Functions par exemple) sans réécrire le moteur.
- **Réponse 200 tout de suite à Meta**, traitement juste après (`after()` de Next.js) : Meta renvoie
  l'événement s'il n'a pas de réponse rapide.
- **Idempotence** : chaque événement reçu est noté une fois (`bot_webhook_evenements.cle_unique` =
  identifiant du message WhatsApp ou de l'événement de commande). Un renvoi de Meta ne produit jamais
  deux réponses.
- **Un message à la fois par contact** : la session porte un numéro de version (verrou optimiste). Si deux
  messages arrivent en même temps, le second relit la session et rejoue.
- **Côté serveur, accès à la base avec la clé `service_role`** (variable `SUPABASE_SERVICE_ROLE_KEY`,
  jamais dans le navigateur ni dans Git). Elle contourne le RLS : c'est pourquoi toutes les écritures
  passent par l'adaptateur existant qui refuse toute table hors `bot_`, et le CRM par le lecteur seul.
- **Envoi** : API Graph (`/{phone_number_id}/messages`) : texte, boutons de réponse (3 max), liste
  (10 lignes max), bouton CTA URL (lien de commande), indicateur « en train d'écrire » + accusé de lecture.
  Les limites WhatsApp sont déjà vérifiées par l'éditeur.
- **Statuts** (envoyé, délivré, lu, échec) reçus par le webhook et notés sur `bot_messages`.

## Découpage (chaque sous-étape testable, validée avant la suivante)

| Sous-étape | Contenu | Ce que Jules vérifie |
|---|---|---|
| **C0** | Décisions (voir plus bas), app Meta et numéro de test créés par Jules avec le [guide](guide-meta.md), variables ajoutées sur Vercel | L'app Meta existe, le token est dans Vercel |
| **C1** | Migration C (SQL montré avant), webhook : vérification Meta, signature, journal des événements bruts. Le bot répond seulement « ✅ Reçu » au numéro de Jules | Un message au numéro de test → « ✅ Reçu » ; un faux appel non signé est refusé |
| **C2** | Le vrai bot sur le numéro de test : canal relié à un resto (Cookies An Nou en test), contacts, sessions, messages, envoi des bulles/boutons/listes/lien, IA, transferts, pauses, statuts | Le parcours du simulateur, mais sur WhatsApp : Accueil, Infos pratiques, IA, « parler à l'équipe » |
| **C3** | Boîte de réception : conversations, messages, réponse manuelle (dans les 24 h), « Reprendre la main / Rendre au bot », alertes de transfert | Répondre à la main, mettre le bot en pause et le relancer |
| **C4** | PFlow Order → bot : événements de commande, panier abandonné, bouton « Retour sur WhatsApp », pré-remplissage. **Modifications montrées avant** ([pflow-order.md](pflow-order.md)) | Une commande test → « Commande enregistrée », « En préparation », « Prête » ; un panier laissé 20 min → relance |
| **C5** | Fonctions IA `suivre_commande` et `annuler_commande` (par le pont existant de PFlow Order) | « Où en est ma commande ? », « Je veux annuler » sur une commande test |
| **C6** | Coexistence : le numéro du gérant reste dans l'appli WhatsApp Business et passe aussi par l'API (échos → pause 12 h). D'abord le numéro de Jules, puis un resto pilote | Répondre depuis l'appli : le bot se tait 12 h |
| **C7** | Bascule d'un resto depuis UChat : liste de contrôle, test, bascule, retour arrière possible. Supervision (alertes si le webhook ou l'envoi échoue) | Un resto pilote 100 % sur PFlow Bots |

Les bots UChat en prod ne sont touchés qu'en C7, resto par resto, avec l'accord de Jules à chaque fois.
Jusque-là, PFlow Order continue d'envoyer vers UChat pour tous les restos qui n'ont pas de canal PFlow
Bots actif (le routage est décidé par PFlow Bots, voir [pflow-order.md](pflow-order.md)).

## Décisions à prendre avant C1

1. **Hébergement du webhook.** Le plan Vercel Hobby est réservé à un usage non commercial. Options :
   - **Vercel Pro** (environ 20 $/mois) : le plus simple, rien à déplacer ;
   - **Supabase Edge Functions** (inclus dans le projet Supabase existant, quota gratuit large) : le
     webhook isolé y est déplacé, l'interface reste sur Vercel ;
   - rester sur Hobby pendant les tests sur le numéro de test uniquement, décider avant le premier vrai resto.

   Recommandation : tests en C1–C3 sur l'existant, puis Supabase Edge Functions pour la prod si le budget
   doit rester à zéro, sinon Vercel Pro. Tarifs et conditions à revérifier au moment de décider.
2. **Propriété des numéros.** Phase 1 : tous les comptes WhatsApp (WABA) dans le Business Manager de
   PFlow, un seul utilisateur système et un seul token (variable `WHATSAPP_TOKEN`). L'onboarding par les
   restos eux-mêmes (« Embedded Signup », statut de fournisseur technique chez Meta) reste pour plus tard.
3. **Coexistence.** Le numéro perso du gérant reste dans son appli WhatsApp Business et passe aussi par
   l'API. Meta la propose via un parcours d'inscription particulier (à vérifier au moment de C6 : conditions,
   pays, historique synchronisé, limites). Sinon, alternative : un numéro dédié aux commandes.
4. **Texte prérempli du bouton « Retour sur WhatsApp ».** Aujourd'hui « Bonjour, je viens de passer la
   commande n° … » : « bonjour » relancerait l'Accueil. Proposition dans [pflow-order.md](pflow-order.md).
5. **Notification du gérant lors d'un transfert.** WhatsApp au gérant (si sa fenêtre de 24 h est ouverte)
   + alerte dans la boîte de réception. Pour l'e-mail (présent dans le template UChat) : service gratuit à
   choisir (ex. offre gratuite d'un service d'envoi d'e-mails), à valider.
6. **Conservation des messages** (RGPD) : proposition 12 mois pour les messages, 30 jours pour les
   événements bruts du webhook, purge automatique. Mention dans la politique de confidentialité de PFlow.

## Variables d'environnement prévues (PFlow Bots, Vercel)

| Variable | Rôle | Secret ? |
|---|---|---|
| `WHATSAPP_TOKEN` | Token de l'utilisateur système Meta (envoi des messages) | Oui |
| `WHATSAPP_APP_SECRET` | Clé secrète de l'app Meta (vérifier la signature `X-Hub-Signature-256`) | Oui |
| `WHATSAPP_VERIFY_TOKEN` | Phrase choisie par Jules pour la vérification du webhook | Oui |
| `WHATSAPP_GRAPH_VERSION` | Version de l'API Graph (ex. `v24.0`, à fixer au moment de C1) | Non |
| `SUPABASE_SERVICE_ROLE_KEY` | Accès serveur aux tables `bot_` (webhook) | Oui |
| `PFLOW_BOTS_SECRET` | Secret partagé avec PFlow Order (signature des événements, jeton de pré-remplissage) | Oui |
| `PONT_CLE` | Clé du pont de PFlow Order (suivi et annulation de commande) | Oui |
| `ANTHROPIC_API_KEY` | Déjà en place (A6) | Oui |

## Coûts

- **WhatsApp** : le bot n'envoie que des messages de service, dans la fenêtre de 24 h ouverte par le
  client (pas de templates en phase 1). Selon la grille de Meta en vigueur depuis juillet 2025, ces
  messages ne sont pas facturés ; à revérifier au moment de C1 (la grille change régulièrement).
- **Claude** : inchangé (A6), suivi par client.
- **Hébergement** : voir la décision 1.

## Hors étape C (phase 2)

Templates Meta (relances hors 24 h, campagnes), messages vocaux (transcription), Instagram/Messenger,
WhatsApp Flows, onboarding des restos par Embedded Signup, avis Google demandés par le bot (l'option
« avis » de PFlow Order existe déjà côté UChat).
