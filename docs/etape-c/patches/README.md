# Patches PFlow Order (étape C) — à appliquer seulement après validation de Jules

Préparés le 5 novembre 2026 sur une **copie** du code de PFlow Order (dépôt `Pflow-Crm`, commit
`5ac768c`). Le dépôt `Pflow-Crm` n'a pas été modifié. Détail et raisons : [`../pflow-order.md`](../pflow-order.md).

| Patch | Fichiers | Contenu |
|---|---|---|
| `01-evenements-commande.diff` | `repo/api/_bot.js`, `repo/tests/pflow-bots.test.js` | Avant UChat, demande à PFlow Bots s'il prend l'événement de commande (appel signé HMAC, délai 8 s). `pris: false`, erreur ou injoignable → UChat exactement comme avant |
| `02-panier-abandonne.diff` | `repo/api/_options.js`, `repo/tests/pflow-bots-relance.test.js` | Relance de panier par PFlow Bots si le resto y est (panier, total, lien de reprise) ; sinon UChat |
| `03-retour-whatsapp.diff` | `repo/js/commande.js` | Pages de confirmation (y compris « Commande payée ») : venu du bot → « Retour sur WhatsApp » avec « ✅ Commande n° 42 passée » ; sinon le bouton d'avant |
| `04-pre-remplissage.diff` | `repo/api/bot-contact.js` (nouveau), `repo/js/commande.js`, `repo/tests/pflow-bots-contact.test.js` | Jeton chiffré `?wa=` du bouton « Commander » → prénom et téléphone WhatsApp pré-remplis |

**Sans les variables `PFLOW_BOTS_URL` et `PFLOW_BOTS_SECRET` dans Vercel (projet PFlow Order), aucun
comportement ne change.** Retirer les variables = retour immédiat à la situation actuelle.

## Appliquer (le jour J, avec l'accord de Jules)

Depuis la racine du dépôt `Pflow-Crm`, sur une branche dédiée :

```bash
git apply --check /chemin/vers/pflow-bot.app/docs/etape-c/patches/01-evenements-commande.diff
```

Puis, dans l'ordre : `git apply` de 01, 02, 03, 04 (un commit par patch), et `npm test` dans `repo/`.

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
- **Reste à faire en C4** : la route `/api/webhooks/pflow-order` qui reçoit ces appels (vérification de la
  signature, routage vers le bon contact, réponse `pris`). Elle dépend des tables de la migration C.
