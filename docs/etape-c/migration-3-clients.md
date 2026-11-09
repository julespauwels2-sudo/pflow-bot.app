# Migration des 3 clients d'UChat vers PFlow Bots (19 → 21 novembre 2026)

Préparé le 9 novembre 2026, **en lecture seule** : rien n'a été changé chez Meta, dans UChat ni dans la base.
Contraintes de Jules :
- abonnement UChat renouvelé le **22 novembre**, à résilier ;
- Jules est absent du **12 au 19** ;
- bascule des 3 clients du **19 au 21**.

## 0. Ce que je sais, et ce que je ne peux pas voir

| | Cookies An Nou | Mexico (Sainte-Rose) | ag_pizzaa |
|---|---|---|---|
| `restaurant_id` (CRM) | `f610eae4-84f4-4a81-bccf-9963a65e0bf7` | `21aa4b81-8464-4b56-97a1-bdc782d0bc22` | `9e3dfdce-afdd-448d-b57a-74656ce7fa89` |
| Bot lié au modèle maître | ✅ depuis le 4 nov. | ✅ depuis le 5 nov. | ✅ depuis le 4 nov., **mais sa copie de l'Accueil le coupe du modèle pour ce flux** (partie 5) |
| Mode de déclenchement | toujours | mots-clés uniquement | mots-clés uniquement |
| Lien de commande `order.pflow.fr/c/<slug>` | `cookies-an-nou` → page en ligne (200) | `mexico` → page en ligne (200) | `ag-pizza` → page en ligne (200) |
| Carte (produits CRM) | 9 (8 disponibles) | 35 | 16 |
| Horaires (CRM) | ✅ | ✅ | ✅ |
| Fiche du bot (zones, paiement, FAQ) | ⚠️ **vide** | ⚠️ **vide** | ⚠️ **vide** |
| Canal dans PFlow Bots | seulement le numéro de test Meta (+1 555…), en test | aucun | aucun |
| IDs Meta du vrai numéro | **inconnus** | **inconnus** | **inconnus** |

**Ce que je ne peux pas vérifier moi-même** : le portefeuille, les IDs, la coexistence, les apps abonnées et
**qui paie** chaque compte de messagerie.
- Le token Meta est dans Vercel, et je ne le lis pas.
- La page État ne teste que les canaux déjà créés.
- Aucune des tables (CRM ou bot_) ne contient les IDs de ces 3 numéros.

D'où la partie 1, **à faire par Jules avant le 12** (≈ 20 min). Elle est en lecture seule, sauf le moyen de
paiement si besoin.

**Ce qu'on sait déjà, par PFlow Démo** (même chemin UChat, même portefeuille PFlow 1) :
- compte WhatsApp dans PFlow 1 ;
- un « compte de messagerie » à part, avec **Smart Link** comme partenaire ;
- c'est l'ID du compte de messagerie qui marche dans l'API ;
- numéro en `CLOUD_API`, en coexistence (`is_on_biz_app: true`) ;
- moyen de paiement : la ligne de crédit Smart Link au départ, **remplacée par la carte de Jules le 8 novembre**.
  On s'attend au même cas pour les 3 restos, à confirmer.

**Smart Link = UChat** : l'appli UChat est éditée par « Smart Link Pty Ltd ». Retirer Smart Link, c'est retirer
UChat.

## 1. Avant le départ (avant le 12 novembre) : vérifications, ≈ 20 min

Méthode détaillée : `diagnostic-numeros.md`. Ne jamais copier ni capturer de token.

Pour **chaque** numéro (Cookies, Mexico, ag pizza), noter :

| | Cookies An Nou | Mexico | ag_pizzaa |
|---|---|---|---|
| Numéro affiché | | | |
| Compte WhatsApp (WABA), propriétaire (PFlow 1 ?) | | | |
| Compte de messagerie (ID), partenaire (Smart Link ?) | | | |
| ID du numéro (`phone_number_id`) | | | |
| `platform_type` (`CLOUD_API` attendu) / `status` (`CONNECTED`) | | | |
| `is_on_biz_app` (coexistence) | | | |
| Apps abonnées (`subscribed_apps` du compte de messagerie) | | | |
| **Moyen de paiement du compte de messagerie** | | | |
| Double vérification (PIN) : activée ? PIN connu ? | | | |

**Où trouver chaque information :**
- Paramètres de l'entreprise, puis Comptes WhatsApp : propriétaire et partenaires.
- WhatsApp Manager, puis Numéros de téléphone : statut, coexistence, ID du numéro, double vérification.
- WhatsApp Manager, puis le compte de messagerie, puis Paramètres de paiement : **qui paie**.
- Explorateur de l'API Graph : `<ID>/phone_numbers?fields=id,display_phone_number,status,platform_type,is_on_biz_app`
  et `<ID>/subscribed_apps`.

**À corriger tout de suite si besoin (avant le 12) :** si un compte de messagerie est payé par **la ligne de
crédit Smart Link**, ajouter **ta carte**, comme pour PFlow Démo le 8 novembre. C'est **le** point qui peut
tout arrêter le 22 (partie 2).

Envoie-moi le tableau rempli (les IDs ne sont pas des secrets) : je complète le SQL de la partie 4.

## 2. Le risque à l'arrêt d'UChat, et comment l'éviter

### Ce qui ne coupe PAS le numéro

- **Le numéro appartient à ton compte WhatsApp (PFlow 1), pas à UChat.** Résilier l'abonnement ne retire pas le
  numéro de l'API. D'autres plateformes le disent noir sur blanc : résilier ne supprime pas le compte WhatsApp,
  et le numéro reste connecté chez Meta tant qu'on ne le supprime pas.
- **L'enregistrement du numéro sur l'API** est fait une fois, au numéro. Il ne dépend pas de l'abonnement
  d'UChat.
- **PFlow Bots reçoit les messages par sa propre app** (abonnement au compte de messagerie avec le token de
  `pflow-bots-serveur`). Si l'app d'UChat reste abonnée sans abonnement payé, elle reçoit des messages et ne
  répond pas : sans effet pour nous.

### Ce qui PEUT tout arrêter

| Risque | Effet | Comment l'éviter |
|---|---|---|
| **Paiement par la ligne de crédit Smart Link** | Meta permet au partenaire de **révoquer** sa ligne de crédit à tout moment, et il le fait quand on le retire. Sans moyen de paiement valide, **plus aucun message payant ne part**. Depuis le 1er octobre 2026, les réponses dans les 24 h le sont aussi : **le bot ne pourrait plus répondre**. | Partie 1 : ta carte sur chaque compte de messagerie **avant** le 22. |
| **« De-register » ou suppression du canal WhatsApp dans UChat** | UChat propose de désenregistrer le numéro dans « WhatsApp Cloud ». Désenregistrer coupe l'API. Pour un numéro en coexistence, le reconnecter demande l'**Embedded Signup**, que PFlow Bots n'a pas : **blocage**. | Dans UChat, **seulement désactiver les bots**. Ne jamais cliquer « De-register », « Disconnect » ou « Delete number ». Laisser l'abonnement expirer, sans supprimer l'espace de travail à la main. |
| **Retrait du partenaire Smart Link** | UChat perd tout accès au compte. Sa ligne de crédit est révoquée (voir plus haut). Pas de preuve trouvée qu'il désenregistre le numéro, mais aucune page de Meta ne garantit le contraire. | **Ne pas retirer Smart Link** pour l'instant. Le garder ne coûte rien. On le retirera plus tard, quand tout tourne depuis des semaines et que ta carte paie partout. |
| **Coexistence : appli non ouverte pendant 13 à 14 jours** | Meta coupe le lien entre l'appli WhatsApp Business et l'API. | Les gérants utilisent leur appli tous les jours : rien à faire, mais à leur dire (partie 3). Ne pas désinstaller l'appli. |
| **Double vérification (PIN)** | Le PIN a été choisi par UChat à l'enregistrement. Il ne sert que si on doit **réenregistrer** le numéro. | Partie 1 : noter s'il est activé. Il se change dans WhatsApp Manager, puis Numéros, puis Double vérification. |

**Conclusion** : résilier UChat le 21, sans rien supprimer chez UChat ni retirer Smart Link, ne déconnecte pas le
numéro. La seule vraie menace, c'est **le moyen de paiement**. Il se vérifie et se règle **avant le 12**.

**Limites de cette conclusion :**
- je n'ai trouvé **aucune** page d'UChat ni de Smart Link qui décrive ce qui se passe à la résiliation ;
- aucune page de Meta ne dit noir sur blanc que le numéro reste enregistré quand on retire un partenaire.

Pour lever le doute :
- demande au support d'UChat avant le 12 : « Si je résilie, est-ce que vous désenregistrez mes numéros WhatsApp
  Cloud API ou révoquez votre ligne de crédit ? » ;
- le 22 et le 23, vérifie la page État de PFlow Bots, « Tester l'accès du token » (statut des numéros).

Sources :
- [Meta : gérer les lignes de crédit (révocation par le partenaire)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines)
- [UChat : se connecter à WhatsApp Cloud API (option « De-register »)](https://uchat.atlassian.net/wiki/spaces/UKB/pages/666632193/Connect+with+WhatsApp+Cloud+API)
- [UChat by SmartLink](https://softwarereview.com/s/uchat)
- [Résilier un fournisseur ne supprime pas le compte WhatsApp](https://faq.userlike.com/all-documents/how-can-i-place-a-cancellation-for-the-whatsapp-business-api)
- [Le numéro reste connecté chez Meta tant qu'on ne le supprime pas](https://www.kommo.com/support/messenger-apps/whatsapp-cloud-api-logging-out-or-deleting-a-number/)
- [Coexistence : appli à ouvrir au moins tous les 13 jours (360dialog)](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence)
- [Coexistence : règle des 14 jours](https://help.seven.io/en/whatsapp/whatsapp-coexistence)
- [Ligne de crédit encore liée après déconnexion (HubSpot)](https://community.hubspot.com/t/whatsapp-waba-still-linked-to-hubspot-shared-credit-line-after-disconnect/159159)

## 3. Le client a-t-il quelque chose à faire ?

**Non, si le numéro est dans ton portefeuille (cas A, attendu).**
- Pas de code, pas de validation, pas de reconnexion : on **ajoute** PFlow Bots au numéro déjà sur l'API.
- Les clients du resto ne voient aucune différence, à part les nouveaux messages du bot.

À leur dire quand même (un message suffit) :
- « Le 19-21, votre bot change de moteur ; rien à faire de votre côté. » ;
- « Gardez l'appli WhatsApp Business sur votre téléphone et ouvrez-la régulièrement (coexistence). » ;
- « Si vous répondez vous-même à un client, le bot se tait 12 h pour ce client. »

**Cas B** : le compte WhatsApp appartient au portefeuille du resto, pas à PFlow 1. Le gérant devra alors
partager l'accès avec PFlow 1, une action dans son Business Manager. La partie 1 le dira. Si c'est le cas,
préviens-le **avant le 12**.

## 4. Préparé, SANS rien appliquer

### 4.1 Les canaux en « test » (SQL à valider, les `<…>` à remplir avec la partie 1)

- **Test** : le bot ne répond qu'à ton numéro (590690938108). Les vrais clients restent sur UChat, et PFlow Order
  continue d'envoyer les commandes à UChat.
- **Pas de `tel_alerte`** : les alertes partent en notification push.
- **Mode** : le même que le bot de chaque resto.

```sql
insert into public.bot_canaux
  (restaurant_id, role, plateforme, compte_id, waba_id, messaging_account_id, numero_affiche,
   mode_declenchement, coexistence, etat, test_numeros)
values
  ('f610eae4-84f4-4a81-bccf-9963a65e0bf7', 'resto', 'whatsapp', '<PHONE_ID_COOKIES>', '<WABA_COOKIES>', '<MSG_COOKIES>',
   '<+590 … (Cookies An Nou)>', 'toujours', <true|false>, 'test', array['590690938108']),
  ('21aa4b81-8464-4b56-97a1-bdc782d0bc22', 'resto', 'whatsapp', '<PHONE_ID_MEXICO>', '<WABA_MEXICO>', '<MSG_MEXICO>',
   '<+590 … (Mexico Sainte-Rose)>', 'mots_cles_uniquement', <true|false>, 'test', array['590690938108']),
  ('9e3dfdce-afdd-448d-b57a-74656ce7fa89', 'resto', 'whatsapp', '<PHONE_ID_AG>', '<WABA_AG>', '<MSG_AG>',
   '<+590 690 90 43 90 (ag pizza)>', 'mots_cles_uniquement', <true|false>, 'test', array['590690938108'])
returning id, restaurant_id, numero_affiche, etat;
```

Contrôles faits sur la table :
- un même numéro ne peut pas avoir deux canaux (`unique (plateforme, compte_id)`) ;
- un canal resto exige un `restaurant_id` ;
- l'état et le mode sont contrôlés.

**Retour arrière** : `delete from public.bot_canaux where compte_id in ('<PHONE_ID_COOKIES>','<PHONE_ID_MEXICO>','<PHONE_ID_AG>') and etat = 'test';`

### 4.2 Les bots liés au modèle maître

- Les 3 sont liés au modèle « Modèle maître » (17 flux : Accueil v2, commande, statuts, IA, infos…).
- Cookies et Mexico n'ont **aucune copie** : ils suivent le modèle.
- ag pizza a une copie de l'Accueil (partie 5).

### 4.3 Cartes et liens de commande

Vérifiés le 9 novembre :
- les 3 liens `order.pflow.fr/c/cookies-an-nou`, `/c/mexico` et `/c/ag-pizza` répondent ;
- produits : Cookies 9 (1 indisponible), Mexico 35, ag pizza 16 ;
- horaires renseignés dans le CRM pour les 3.

⚠️ **Fiches du bot vides pour les 3** (zones et jours de livraison, points de vente, modes de paiement, FAQ).
- Le bot marche sans elles : les infos absentes ne sont pas affichées.
- Mais « Infos pratiques » et l'IA seront pauvres.
- À remplir dans PFlow Bots, page du client, puis Fiche, **avant le 19**, ou le 19 au matin (10 min par resto).
- Cookies est le seul en livraison (`livraison = true`) : ses zones et jours sont les plus importants.

## 5. ag pizza : relier sa copie de l'Accueil au modèle

Comparaison faite le 9 novembre, en lecture seule :

| | Copie d'ag pizza (faite sur l'Accueil v1) | Modèle (Accueil v2) |
|---|---|---|
| Mots-clés | bonjour, salut, hello, menu, **commander** | bonjour, **bonsoir**, salut, hello, **coucou**, menu (« commander » est dans « CTA - Commander ») |
| Message d'accueil | identique, mot pour mot | identique |
| Boutons | Commander, Me conseiller, Infos pratiques | identiques |
| Version courte (client déjà venu dans les 12 h) | **absente** | « Que puis-je faire pour vous ? » + 3 boutons |

**La copie n'a aucune personnalisation** : la supprimer ne fait rien perdre, et ag pizza retrouve les mises à jour
du modèle.

**Méthode recommandée (le 19)** : PFlow Bots → Clients → ag_pizzaa → flux Accueil → **« Revenir au modèle »**.

Équivalent SQL, pour mémoire (**ne pas appliquer sans accord**). Sauvegarde, puis suppression de la copie :

```sql
-- Sauvegarde (lecture) : garder le résultat
select id, nom, publie from public.bot_flux where id = '9eb0548b-7aac-4cf0-8305-ab83df14795f';

-- Suppression de la copie (ag pizza retombe sur l'Accueil du modèle)
delete from public.bot_flux
 where id = '9eb0548b-7aac-4cf0-8305-ab83df14795f'
   and proprietaire_type = 'client'
   and proprietaire_id = '9e3dfdce-afdd-448d-b57a-74656ce7fa89'
   and remplace_flux_modele_id = 'd65d8540-cc66-4628-a795-18f9ab5c2729'
returning id, nom;
```

Test : dans le simulateur, choisir ag_pizzaa, écrire « bonsoir » (accueil complet), puis « coucou » (version
courte).

## 6. Runbooks (19 → 21 novembre)

Principe : **canal en test** (seul ton numéro), puis tests, puis **désactivation du bot UChat** du numéro, puis
**« Passer en actif »**.

Retour arrière en 2 minutes, à tout moment :
1. page État : canal → **« Repasser en test »** (PFlow Order renvoie aussitôt les commandes à UChat) ;
2. **réactiver le bot UChat** du numéro.

Ordre : Cookies (mode « toujours », le plus exposé) d'abord, puis Mexico et ag pizza (numéros perso des gérants,
mots-clés uniquement).

### Prérequis communs (le 19 au matin, ≈ 30 min)

- [ ] Partie 1 faite, et **ta carte** sur les 3 comptes de messagerie.
- [ ] SQL 4.1 complété avec les IDs et validé, puis appliqué (3 canaux en **test**).
- [ ] App PFlow Bots : champ du webhook **`smb_message_echoes`** abonné (sinon le bot ne se tait pas quand le
      gérant répond depuis l'appli).
- [ ] Fiches remplies (4.3).
- [ ] Notifications push actives sur ton iPhone (page État, notification de test reçue).
- [ ] Clés VAPID dans Vercel ; `PFLOW_ORDER_PONT_CLE` présente (page État, « Clés détectées »).

### Cookies An Nou : 19 novembre (≈ 1 h)

- [ ] (5 min) Paramètres de l'entreprise, puis `pflow-bots-serveur`, puis Attribuer : compte WhatsApp **et**
      compte de messagerie de Cookies, en contrôle total.
- [ ] (2 min) Page État, Canaux, Cookies (vrai numéro), **« Abonner PFlow Bots »** ; puis **« Tester l'accès du
      token »** : toutes les lignes OK, PFlow Bots dans « Apps abonnées ».
- [ ] (2 min) UChat : **mettre en pause le bot pour ton contact seulement** (pas pour les clients).
- [ ] (15 min) Depuis ton numéro :
  - [ ] « Bonjour » : accueil Cookies ;
  - [ ] une question (« vous livrez où ? ») : l'IA répond ;
  - [ ] « je veux commander » : lien `order.pflow.fr/c/cookies-an-nou` ;
  - [ ] « je veux parler à quelqu'un » : transfert + **notification push** sur ton iPhone.
- [ ] (5 min) Page État, **Événement de commande de test**, canal Cookies (vrai numéro) : « Commande
      enregistrée » arrive sur ton téléphone **depuis le numéro de Cookies**.
- [ ] (5 min) Si coexistence : depuis l'appli WhatsApp Business de Cookies (ou demander au gérant), écrire à ton
      numéro, puis écrire « Bonjour » au bot : **pas de réponse** (pause de 12 h). Rendre au bot depuis la boîte de
      réception.
- [ ] (1 min) UChat : **désactiver le bot** de ce numéro. **Ne pas** « De-register », ne rien supprimer.
- [ ] (1 min) Page État, Cookies, **« Passer en actif »**.
- [ ] (15 min) Contrôle :
  - [ ] faire écrire un proche, qui reçoit une réponse ;
  - [ ] à la prochaine vraie commande, « Commande enregistrée » arrive sur WhatsApp ;
  - [ ] dans le CRM, le journal du bot affiche `pflow_bots: pris`.

**Retour arrière** : « Repasser en test », puis réactiver le bot UChat.

### Mexico (Sainte-Rose) : 20 novembre (≈ 45 min)

Mêmes étapes que Cookies, avec ses IDs. Le bot est en **mots-clés uniquement** :
- tester **« Bonjour »** (mot-clé de l'Accueil) et **« menu »** ;
- vérifier qu'un message sans mot-clé (« ok merci ») **n'a pas de réponse** : c'est le numéro perso du gérant.

- [ ] Attribuer les éléments, abonner, tester l'accès.
- [ ] Pause UChat pour ton contact, puis les tests (accueil, commande, transfert + push, événement de commande
      de test).
- [ ] Test de la pause de 12 h (le gérant écrit depuis son appli, si possible avec lui).
- [ ] Désactiver le bot UChat (rien supprimer), puis **« Passer en actif »**, puis le contrôle.

### ag_pizzaa : 20 novembre (≈ 45 min)

- [ ] **D'abord** : « Revenir au modèle » sur son Accueil (partie 5), puis le test au simulateur.
- [ ] Puis mêmes étapes que Mexico (mots-clés uniquement, numéro perso du gérant).

### 21 novembre : clôture d'UChat (≈ 20 min)

- [ ] Les 3 canaux en **actif** depuis au moins quelques heures, sans incident.
- [ ] Page État : pas de bandeau rouge ; « Tester l'accès du token » : tout est OK.
- [ ] **Résilier l'abonnement UChat** (fin au 22). **Ne pas** désenregistrer les numéros, **ne pas** retirer
      Smart Link, **ne pas** supprimer l'espace de travail.
- [ ] Le 22 et le 23 : page État, « Tester l'accès du token » ; un message de test à chaque numéro.
- [ ] Plus tard (pas avant que tout tourne depuis 2 à 4 semaines) :
  - [ ] retirer Smart Link ;
  - [ ] renouveler `PONT_CLE` ;
  - [ ] retirer `UCHAT_API_KEY` du CRM.

### Si un numéro est coupé après le 22

1. **Paiement** (cause la plus probable) : WhatsApp Manager, compte de messagerie, Paramètres de paiement. Ajouter
   la carte. Les envois reprennent.
2. **Numéro désenregistré** (statut différent de `CONNECTED`) :
   - hors coexistence, il se réenregistre par l'API (`POST <PHONE_ID>/register` avec le PIN de double
     vérification, changeable dans WhatsApp Manager) ;
   - **en coexistence**, il faut l'Embedded Signup, que PFlow Bots n'a pas (voir `nouveau-client.md`). Le gérant
     garde son appli WhatsApp Business en attendant : il répond lui-même.
