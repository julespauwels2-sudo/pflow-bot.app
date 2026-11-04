# Étape C — modifications prévues dans PFlow Order (dépôt `Pflow-Crm`)

**À montrer et faire valider par Jules avant toute modification.** Les patches prêts à appliquer sont
dans [`patches/`](patches/README.md). Rien n'a été modifié : le code a été lu
en lecture seule (commit `5ac768c` du 3 novembre 2026). Aucune table du CRM n'est modifiée par ces
changements : tout passe par du code et deux variables d'environnement.

## Principe : un aiguillage, UChat reste le chemin par défaut

PFlow Order envoie déjà **tous** les événements de commande au bot par un point unique :
`repo/api/_bot.js`, fonction `synchroniser()` (appelée par `api/notifier.js`, `api/paiement.js`,
`api/pont.js`). Les relances de panier passent par `repo/api/_options.js`, fonction `envoyerUn()`.

La modification ajoute **une question avant UChat** : « ce resto est-il sur PFlow Bots ? ». C'est PFlow
Bots qui répond (il connaît ses canaux) :
- `pris: true` : PFlow Bots a traité l'événement (envoyé, ou ignoré car fenêtre de 24 h fermée) ; PFlow
  Order note le résultat comme aujourd'hui et **n'appelle pas UChat** ;
- `pris: false` (resto sans canal PFlow Bots actif, numéro hors liste de test) ou PFlow Bots injoignable :
  **le chemin UChat actuel est suivi sans aucun changement**.

Sans la variable `PFLOW_BOTS_URL`, rien ne change du tout : la bascule est réversible en retirant la variable.
La règle du CRM « le CRM ne crée aucun message » reste vraie : c'est le bot (ses flux) qui écrit.

## Variables d'environnement à ajouter (projet Vercel de PFlow Order)

| Variable | Valeur |
|---|---|
| `PFLOW_BOTS_URL` | `https://bots.pflow.fr` (ou l'adresse Vercel de PFlow Bots) |
| `PFLOW_BOTS_SECRET` | Secret partagé, identique dans PFlow Bots (long, aléatoire) |

## 1. Événements de commande — `repo/api/_bot.js`

**Où :** dans `synchroniser()` (ligne 321), juste après la ligne 335
(`var c = d.commande, resto = d.resto || {}, reg = d.reglages;`), avant la recherche de la clé UChat.

**Quoi :** une nouvelle fonction `envoyerPflowBots(c, resto, evts, source)` dans le même fichier :
- `POST {PFLOW_BOTS_URL}/api/webhooks/pflow-order`, délai maximum 8 s ;
- en-têtes : `Content-Type: application/json`, `X-PFlow-Horodatage: <secondes>`,
  `X-PFlow-Signature: sha256=<HMAC-SHA256(PFLOW_BOTS_SECRET, horodatage + "." + corps)>`
  (PFlow Bots refuse une signature fausse ou un horodatage de plus de 5 minutes) ;
- corps :

```json
{
  "type": "commande",
  "restaurant_id": "<uuid>",
  "slug": "cookies-an-nou",
  "client_tel": "590690123456",
  "commande_id": "<uuid>",
  "evenements": ["commande", "en_preparation"],
  "champs": { "customer_name": "Léa", "order_number": "42", "order_summary": "2 x Tout choco",
              "order_total_display": "8 €", "order_mode_display": "Livraison", "payment_method": "sur_place",
              "order_status": "En préparation", "order_slot_display": "…", "order_eta_display": "…" }
}
```

  `champs` = exactement ce que renvoie déjà `champsDe()` (ligne 156) ; `client_tel` passe par
  `numeroInternational()` (ligne 201) ;
- réponse attendue : `{ "pris": true, "envois": { "commande": { "etat": "ok|ignore|echec", "detail": "…" } } }`.

**Puis :** si `pris` est vrai, remplir `envois` avec la réponse, appeler `fin()` (journal et `bot_noter`,
comme aujourd'hui) et `return`. Sinon, continuer vers UChat sans rien changer.

**Correspondance des événements** (côté PFlow Bots) :

| PFlow Order (`EVENEMENTS`) | PFlow Bots | Flux du modèle maître |
|---|---|---|
| `commande`, `paiement` | `commande_validee` | Commande - Paiement validé (existe) |
| `en_preparation` | `commande_en_preparation` | Statut - En préparation (existe) |
| `prete` | `commande_prete` | Statut - Prête (existe) |
| `annulee` | `commande_annulee` | à créer en C4 |
| `remboursee` | `commande_remboursee` | à créer en C4 |
| `annulation_refusee` | `annulation_refusee` | à créer en C4 |
| `rappel` (commande prête pas récupérée) | `rappel_commande_prete` | à créer en C4 |

**Correspondance des champs** (variables déjà prévues en M3c) : `customer_name` → `{{client_nom}}`,
`order_number` → `{{commande_numero}}`, `order_summary` → `{{commande_recap}}`, `order_total_display` →
`{{commande_total}}`, `order_mode_display` → `{{commande_mode}}`, `payment_method` → `{{paiement_mode}}`,
`order_status` → `{{commande_statut}}` ; nouveaux : `order_slot_display` → `{{commande_creneau}}`,
`order_eta_display` → `{{commande_delai}}`.

**Tests à ajouter** (`repo/tests`) : signature calculée correctement ; `pris: true` → UChat jamais appelé ;
`pris: false`, délai dépassé ou erreur → chemin UChat identique à aujourd'hui ; sans `PFLOW_BOTS_URL` →
aucun appel à PFlow Bots.

## 2. Panier abandonné — `repo/api/_options.js`

Rien à changer au calcul : PFlow Order garde déjà les paniers (`paniers_ouverts`), attend le délai réglé
(20 min par défaut, 10 à 180 min, `options_reglages.relance.delai_min`) et prépare le lien de reprise
`…/c/<slug>?reprise=<jeton>&via=wa`.

**Où :** dans `envoyerUn()` (ligne 117), avant `var U = BOT.clientUchat(cle);` (ligne 124), seulement pour
`e.type === "relance"`.

**Quoi :** le même appel signé que ci-dessus, avec :

```json
{
  "type": "option",
  "option": "relance",
  "restaurant_id": "<uuid>",
  "client_tel": "590690123456",
  "client_nom": "Léa",
  "panier": { "recap": "2 x Tout choco", "total": "8 €", "lien": "https://…/c/cookies-an-nou?reprise=…&via=wa" }
}
```

PFlow Bots lance le flux « Panier abandonné » (événement `panier_abandonne`, variables `{{panier_recap}}`,
`{{panier_total}}`, `{{lien_panier}}`), **seulement si** la fenêtre de 24 h est ouverte et l'option
« Relance panier abandonné » active pour ce resto. Réponse `pris: true` + `etat: envoye | ignore` (avec la
raison) → `fin()` comme aujourd'hui. `pris: false` → chemin UChat actuel.

L'option « avis » (demande d'avis Google) pourra suivre le même chemin plus tard (événement
`demande_avis`) ; les campagnes restent hors étape C (templates Meta).

**Bouton « ❌ Laisser tomber »** du flux : PFlow Bots appellera le pont existant (action `stop`, ou une
action dédiée si Jules préfère marquer seulement ce panier) — à décider en C4.

## 3. Bouton « Retour sur WhatsApp » — `repo/js/commande.js`

Le bouton existe déjà : « Écrire au restaurant sur WhatsApp » dans `confirmation()` (ligne 1360), vers
`resto.numero_whatsapp`, avec le texte « Bonjour, je viens de passer la commande n° … ».

**Modifications :**
1. Quand le client vient du bot (`viaBot()`, ligne 253), le libellé devient **« Retour sur WhatsApp »**.
2. Le texte prérempli ne commence plus par « Bonjour » (le mot-clé relancerait l'Accueil du bot) :
   proposition **« ✅ Commande n° 42 passée »**. PFlow Bots reconnaît ce texte et ne relance aucun flux
   (la confirmation part déjà par l'événement `commande_validee`).
3. Même bouton sur la page « Commande payée » : `confirmationPayee()` (ligne 1346) n'en a pas aujourd'hui.
4. Le numéro du bouton reste `resto.numero_whatsapp` : avec la coexistence, c'est le numéro du bot. Si un
   resto a un numéro dédié au bot différent, il faudra le donner à la page (à voir en C6).

## 4. Pré-remplissage (option 3 du lien de commande)

**But :** le client venu du bot ne retape ni son prénom ni son numéro, et la commande est rattachée à sa
conversation (le numéro saisi = son numéro WhatsApp, donc les événements trouvent le bon contact).

**Côté PFlow Bots :** le bouton « Commander » ajoute au lien un jeton `wa=<jeton>` : numéro WhatsApp,
prénom du profil, resto et expiration (2 h), **chiffré** (AES-GCM avec `PFLOW_BOTS_SECRET`) pour que le
numéro n'apparaisse jamais en clair dans l'adresse.

**Côté PFlow Order :**
1. **Nouveau fichier `repo/api/bot-contact.js`** : `POST { slug, jeton }` → déchiffre, vérifie
   l'expiration et le resto, renvoie `{ tel, prenom }`. Ne lit ni n'écrit rien en base.
2. **`js/commande.js`, `signalBot()`** (ligne 233) : lit aussi `wa`, l'envoie à `/api/bot-contact`, et
   pré-remplit `client` (prénom et téléphone, toujours modifiables) avant l'affichage du formulaire
   (champs `c-nom` et `c-tel`, ligne 1093). Retire `wa` de l'adresse, comme `via` aujourd'hui.
3. Aucune nouvelle colonne : le rattachement passe par le numéro (déjà dans `commandes.client_tel`). Les
   statistiques « commandes venues du bot » seront calculées côté PFlow Bots (jetons émis → commandes
   reçues par événement).

À ne pas faire : passer `canal: "whatsapp"` depuis la page. Ce canal est réservé aux commandes créées
par le bot via le pont, et une règle de `sql/s7-service.sql` (vers la ligne 803) en dépend.

## 5. Suivi et annulation (fonctions IA, sous-étape C5) — aucune modification

Le pont existant (`repo/api/pont.js`) sait déjà faire `suivi` et `annulation` (avec `slug` et
`client_tel`, en-tête `x-pflow-cle` = `PONT_CLE`). PFlow Bots l'appellera tel quel : il faudra seulement
mettre `PONT_CLE` dans les variables de PFlow Bots.

## 6. Plus tard (pas en C4)

- `repo/api/supervision.js` surveille les bots UChat : y ajouter PFlow Bots (webhook, envois en échec).
- Quand un resto est entièrement passé sur PFlow Bots (C7), ses réglages UChat (`bot_reglages`,
  `bot_cles`) restent en place mais ne servent plus ; on ne les supprime pas sans l'accord de Jules.

## Ordre de mise en place proposé (C4)

1. PFlow Bots : route `/api/webhooks/pflow-order` (signature, idempotence, réponse `pris`), testée seule.
2. PFlow Order : modification 1 derrière `PFLOW_BOTS_URL`, d'abord sur un déploiement de prévisualisation
   Vercel, avec une commande de test sur le numéro de test.
3. Modifications 2, 3 et 4, une par une, chacune montrée puis testée.
