# Patches PFlow Order (étape C) — à appliquer seulement après validation de Jules

Préparés le 5 novembre 2026 sur une **copie** du code de PFlow Order (dépôt `Pflow-Crm`, commit
`5ac768c`). Le dépôt `Pflow-Crm` n'a pas été modifié. Détail et raisons : [`../pflow-order.md`](../pflow-order.md).

| Patch | Fichiers | Contenu |
|---|---|---|
| `01-evenements-commande.diff` | `repo/api/_bot.js`, `repo/tests/pflow-bots.test.js` | Avant UChat, demande à PFlow Bots s'il prend l'événement de commande (appel signé HMAC, délai 8 s). `pris: false`, erreur ou injoignable → UChat exactement comme avant |
| `02-panier-abandonne.diff` | `repo/api/_options.js`, `repo/tests/pflow-bots-relance.test.js` | Relance de panier par PFlow Bots si le resto y est (panier, total, lien de reprise) ; sinon UChat |
| `03-retour-whatsapp.diff` | `repo/js/commande.js` | Pages de confirmation (y compris « Commande payée ») : venu du bot → « Retour sur WhatsApp » avec « ✅ Commande n° 42 passée » ; sinon le bouton d'avant |
| `04-pre-remplissage.diff` | `repo/api/bot-contact.js` (nouveau), `repo/js/commande.js`, `repo/tests/pflow-bots-contact.test.js` | Jeton chiffré `?wa=` du bouton « Commander » → prénom et téléphone WhatsApp pré-remplis |
| `05-paiement-offre-de-base.diff` | `repo/sql/qg64-paiement-offre-de-base.sql` (nouveau), `repo/js/paiement.js`, `repo/js/resto.js`, `repo/js/atelier.js`, `repo/js/supervision.js`, `repo/api/paiement.js`, `repo/tests/qg64-paiement-base.test.js` | Le paiement en ligne fait partie de l'offre de base : l'ancienne « option vendue » (`paiement_restos.module`) ne bloque plus rien (voir plus bas) |
| `06-pont-cle-transition.diff` | `repo/api/pont.js`, `repo/tests/pont-cle-ancienne.test.js` | **Mis de côté** (décision de Jules : la clé n'a jamais fui, pas de changement avant l'arrêt d'UChat). `PONT_CLE_ANCIENNE` acceptée pendant un changement de clé |
| `08-garde-fou-canal-actif.patch` (C4) | `repo/sql/qg66-pflow-bots-canal-actif.sql` (nouveau), `repo/api/_bot.js`, `repo/tests/pflow-bots*.test.js`, `repo/tests/qg66-pflow-bots-canal-actif.test.js` | **Garde-fou absolu** : PFlow Order n'appelle PFlow Bots que si le resto a un canal WhatsApp **« actif »** (fonction `pflow_bots_canal_actif`). Canal en test, coupé ou absent, fonction absente, base injoignable : UChat. Variables des flux (`{{commande_mode}}`…) tirées de la commande |
| `09-bot-contact-sans-13e-fonction.patch` (C4) | `repo/api/_bot-contact.js` (renommé), `repo/api/pont.js`, `repo/vercel.json`, test | Le patch 04 ajoutait une 13e fonction serveur : Vercel (offre Hobby, 12 max) refusait le déploiement. `/api/bot-contact` est réécrit vers `/api/pont?bot_contact=1`, comme `/api/calcul` |
| `07-option-paiement-retiree.diff` | `repo/sql/qg65-paiement-inclus.sql` (nouveau), `repo/js/app.js`, `repo/js/facturation.js`, `repo/js/resto.js`, `repo/js/dashboard-demo.js`, `repo/js/paiement.js`, `repo/guide-paiement-en-ligne.html`, `repo/tests/qg65-paiement-inclus.test.js` | Retrait de l'option « Paiement en ligne » à 79 € : catalogue, MRR, boutons « +79 € », Dashboard, guide. **À appliquer après le 05** |

**C4 (7 novembre 2026)** : 01 à 05 et 07 appliqués (un commit chacun) sur `6ca596b` (dernière version de
`main`), plus le garde-fou 08 ; **pull request ouverte, non fusionnée** (branche `pflow-bots-c4`). Le 06 reste
de côté. Côté PFlow Bots : route `/api/webhooks/pflow-order` (même règle du canal « actif », double barrière).

**Sans les variables `PFLOW_BOTS_URL` et `PFLOW_BOTS_SECRET` dans Vercel (projet PFlow Order), aucun
comportement ne change.** Retirer les variables = retour immédiat à la situation actuelle.

Les patches 05 et 06 ont été préparés plus tard, sur le commit `58c5b5a`, et le 07 sur `08dd2e3`.
**Vérifié le 6 novembre 2026 : les 7 patches s'appliquent dans l'ordre (01 à 05, 07, puis 06) sur `08dd2e3`.**

## Patch 05 — le paiement en ligne dans l'offre de base

**Ce qui change** : partout où l'ancienne option vendue (`paiement_restos.module`) bloquait quelque
chose, elle ne compte plus. Seul compte ce qui est prêt chez le prestataire (SumUp ou Stripe) et le
réglage du resto (au choix / obligatoire / coupé).
- SQL (`qg64`, rejouable, greffes vérifiées : rien n'est fait si un point de greffe manque) :
  `paiement_mode_public`, `agent_mode_effectif`, `ag_phase_paiement` (sans ligne paiement : « dossier
  à préparer » au lieu de « option non vendue »), `ag_executer`, `paiement_activation_lien` et
  `paiement_regler` (créent la ligne paiement si besoin), `paiement_activation_pour`,
  `sup_comptes_stripe`, `sup_evaluer`.
- CRM (Atelier, panneau Paiement) : plus de bouton « Activer l'option / Option VENDUE » ; le dossier
  et le mode de paiement sont toujours proposés. Dashboard du resto : plus d'offre « demandez l'option »,
  le message dit que le paiement par carte fait partie de son offre. Supervision : l'état réel au lieu
  de « Sur place ». API : `DOSSIER_A_PREPARER` au lieu de `OPTION_NON_ACTIVEE`.
- **Pas touché (décision commerciale à prendre)** : la facturation du module « paiement » (79 € sur la
  fiche de prix, MRR, bouton « Paiement en ligne +79 € » de la fiche client, catalogue des modules).
  La colonne `module` reste en base (plus aucune fonction ne la lit) : retour arrière possible.

**Ce qui changerait pour chaque resto** (calculé en lecture seule sur la base, novembre 2026) :

| Resto | Statut | Ancienne option | Paiement en vigueur avant → après | Atelier (étape paiement) | Dashboard |
|---|---|---|---|---|---|
| ag_pizzaa | actif | vendue | au choix → au choix | inchangé | inchangé |
| Mexico | actif | vendue | au choix → au choix | inchangé | inchangé |
| Croustiz Pointe à pitre | signé | vendue | sur place → sur place (Stripe pas prêt) | inchangé | inchangé |
| Pasta Table | signé | vendue | sur place → sur place (Stripe pas prêt) | inchangé | inchangé |
| **Cookies An Nou** | actif | **non vendue** | sur place → sur place (Stripe pas prêt) | « option non vendue » → **« dossier à préparer »** | l'offre « demandez l'option » devient « fait partie de votre offre » |
| Gwada food | démo | aucune ligne | sur place → sur place | « non vendue » → « dossier à préparer » | idem Cookies |
| Gwada Smash Burger | démo | aucune ligne | sur place → sur place | « non vendue » → « dossier à préparer » | idem Cookies |

**Aujourd'hui, le paiement en vigueur ne change pour aucun resto.** La différence apparaîtra pour
Cookies An Nou quand son Stripe sera prêt : le paiement en ligne marchera sans « vendre l'option ».
L'agent Atelier proposera désormais les étapes du paiement pour Cookies An Nou.

**Vérifié** : nouveau test `qg64` (échoue sans le patch, passe avec : mode en vigueur sans option,
phase Atelier, création de la ligne paiement, fichier rejouable) ; 140 tests existants du CRM qui
touchent au paiement, à l'Atelier, à la supervision et au Dashboard : tous passent (1 ignoré, Deno absent).

## Patch 07 — l'option « Paiement en ligne » à 79 € est retirée

Décision de Jules (6 novembre 2026) : personne ne la paie, le paiement en ligne est inclus dans la formule.

**Constat en base (lecture seule)** : l'option coûte **déjà 0 €** dans le catalogue des modules, les
8 lignes « paiement » des restos sont à 0 €, et **aucune facture** n'a jamais porté ce module. Les
« 79 € » ne viennent que du code (valeur par défaut, textes, démo du Dashboard, guide).

**Ce qui change** (même méthode que pour les zones de livraison, `qg44`) :
- SQL `qg65` (rejouable, après `qg64`) : le module « paiement » du catalogue passe « inclus dans la
  formule », 0 €, état « retiré » (plus proposé comme option) ; l'ancienne fiche est gardée dans
  `qg_sauvegardes` ; les prix figés des restos ramenés à 0 € s'il en reste.
- CRM : plus de bouton « Paiement en ligne +79 € » (fiche client, dialogue de signature, offre proposée) ;
  plus d'ajout automatique de l'option au passage en « proposition » ; MRR et mensualité calculés sans
  elle ; plus de mention « sans le paiement en ligne tant que Stripe n'est pas actif ».
- Dashboard du resto : « Paiement en ligne — inclus » affiché à part (comme « Gestion du stock »), plus
  de carte d'option. Dashboard de démo : la carte « Paiement en ligne 79 € » disparaît.
- Textes : panneau Paiement du CRM et guide du paiement en ligne (« inclus dans la formule »).

**Volontairement non touché** :
- `pf_module_ok('paiement')` : le rendre vrai pour tous ferait créer une ligne de paiement pour chaque
  resto (synchro `pf_modules_sync`) — repéré par les tests, retiré du patch ;
- la checklist d'installation (`install_bloquants`) : son étape « Paiement » ne s'affiche que pour les
  restos qui avaient l'option, et elle ne connaît que Stripe (elle bloquerait à tort un resto sur SumUp).
  **À reprendre plus tard** si tu veux que l'étape apparaisse pour tous ;
- les factures (aucune concernée) et les lignes « paiement » des restos (gardées pour l'historique).

**Vérifié** : nouveau test `qg65` (échoue sans le SQL, passe avec ; rejouable ; aucune ligne paiement
créée d'office) ; 204 tests du CRM liés au paiement, aux modules, à la facturation et au Dashboard :
tous verts (2 ignorés, Deno absent), avec 05 et 07 appliqués sur `08dd2e3`.

## Patch 06 — changer `PONT_CLE` sans couper UChat (mis de côté)

> **Décision de Jules (6 novembre 2026)** : la clé n'a jamais fui, pas de changement. À renouveler
> après l'arrêt d'UChat (noté dans `docs/plan.md`) ; ce patch ne servira alors plus (plus de bots UChat).

`api/pont.js` n'accepte qu'une clé : changer `PONT_CLE` coupe chaque bot UChat jusqu'à ce que son
Bot Field `pflow_cle` soit mis à jour. Avec ce patch, `PONT_CLE_ANCIENNE` (variable Vercel facultative)
est aussi acceptée pendant la transition, puis on la retire. Sans la variable : comportement identique.
**Vérifié** : nouveau test (échoue sans le patch, passe avec) + tests existants du pont.

## Appliquer (le jour J, avec l'accord de Jules)

Depuis la racine du dépôt `Pflow-Crm`, sur une branche dédiée :

```bash
git apply --check /chemin/vers/pflow-bot.app/docs/etape-c/patches/01-evenements-commande.diff
```

Puis, dans l'ordre : `git apply` de 01, 02, 03, 04, 05, 07 (un commit par patch ; 07 après 05), et
`npm test` dans `repo/`. Pour 05 et 07 : jouer ensuite dans Supabase (SQL Editor), après le déploiement
du code, `repo/sql/qg64-paiement-offre-de-base.sql` **puis** `repo/sql/qg65-paiement-inclus.sql`.

## Vérifié

- Les 4 patches s'appliquent proprement, dans l'ordre, sur le commit `5ac768c`.
- Tests de PFlow Order touchant ces fichiers + nouveaux tests : 47 sur 48 passent. Le seul échec
  (« option B : le contrat papier… ») échoue **aussi sans les patches** dans cet environnement.
- Interopérabilité du jeton : un jeton créé par PFlow Bots (`src/channels/pflow-order/contact-token.ts`)
  est bien lu par `repo/api/bot-contact.js`, et refusé pour un autre resto.
- Non testé dans un navigateur : la page de commande (`commande.js`) — seulement la syntaxe, la fonction
  du bouton isolée, et les tests existants.

## Côté PFlow Bots (déjà fait, inactif)

- Le texte « ✅ Commande n° 42 passée » ne déclenche ni l'accueil ni l'IA (`ORDER_RETURN_PATTERN`).
- Le bouton « Commander » envoyé sur WhatsApp porte `?via=wa` et, si `PFLOW_BOTS_SECRET` est défini, le
  jeton `wa=` (jamais dans le simulateur).
- **Fait en C4** : la route `/api/webhooks/pflow-order` (`src/channels/pflow-order/order-events.ts`) :
  signature et horodatage, canal « actif » seulement (simulation de la page État : canal en test, numéro de
  test), contact existant seulement (pas de contact créé), idempotence par commande et événement.
  **Pas encore gérés** (ignorés, expliqués dans le journal du CRM, aucun message) : `annulee`, `remboursee`,
  `annulation_refusee`, `rappel`. À ajouter (flux + événements) avant de basculer un resto qui en a besoin.
