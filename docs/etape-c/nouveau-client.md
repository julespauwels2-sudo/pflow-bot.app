# Nouveau client : de « signé » à « bot actif sur son numéro », sans UChat

État des lieux du 9 novembre 2026. **Rien n'est codé ici** : constat et recommandation.

## 1. Le parcours réel aujourd'hui

| # | Étape | Qui | Outil | État |
|---|---|---|---|---|
| 1 | Resto « signé » (statut actif), slug, carte, horaires, options | Jules | CRM / PFlow Order | ✅ en place |
| 2 | Bot créé et lié au modèle maître | automatique | PFlow Bots, à l'ouverture de l'app | ✅ en place |
| 3 | Fiche du bot (zones, jours de livraison, paiement, FAQ), mode de déclenchement, essai au simulateur | Jules | PFlow Bots | ✅ en place (≈ 15 min) |
| 4 | **Mettre le numéro WhatsApp du resto sur l'API** | Jules + client | Meta | ❌ **le trou** (partie 2) |
| 5 | Attribuer le compte WhatsApp et le compte de messagerie à `pflow-bots-serveur`, abonner PFlow Bots | Jules | Meta + page État (« Abonner PFlow Bots ») | ✅ possible à la main (≈ 5 min) |
| 6 | Créer le canal en test | Jules | **SQL à la main** | ⚠️ pas d'écran |
| 7 | Tests depuis le numéro de Jules, événement de commande de test | Jules | Téléphone + page État | ✅ en place |
| 8 | Moyen de paiement du compte de messagerie | Jules (ou client) | WhatsApp Manager | ⚠️ à décider : qui paie Meta ? |
| 9 | « Passer en actif » | Jules | Page État | ✅ en place |

**Le client** n'a à faire qu'une chose : l'étape 4, donner l'accès à son numéro. C'est justement ce qui manque.

## 2. Le trou : mettre le numéro du resto sur l'API

Avant, c'était UChat (Smart Link) qui le faisait, avec son parcours d'inscription intégré de Meta, l'**Embedded
Signup**. Les 3 numéros actuels sont arrivés ainsi dans ton portefeuille. Sans UChat, il reste deux voies.

### Voie 1 : sans code, mais le resto perd son appli sur ce numéro

Tu ajoutes le numéro toi-même : WhatsApp Manager, puis Ajouter un numéro. Le gérant te lit le code reçu par SMS ou
par appel, Meta valide le nom affiché, puis on l'enregistre sur l'API.

- **Impossible en coexistence.** Le numéro ne doit plus être utilisé dans l'appli WhatsApp ou WhatsApp Business :
  soit un **nouveau numéro** (nouvelle puce), soit le gérant **supprime son compte WhatsApp** sur ce numéro
  (il perd ses discussions). Pour un resto qui reçoit déjà ses clients sur son numéro, c'est rarement acceptable.
- Le numéro est dans **ton** portefeuille, au nom du resto. Le nom affiché passe par la revue de Meta : un refus
  est possible si le lien entre PFlow 1 et le resto n'est pas évident.
- Utilisable dès maintenant, pour un resto qui accepte un numéro dédié.

### Voie 2 : Embedded Signup avec coexistence (le resto garde son appli)

C'est la voie normale. Le gérant ouvre un lien envoyé par toi, se connecte avec son Facebook, choisit son numéro
**et le garde dans son appli WhatsApp Business** (coexistence, avec scan d'un code dans l'appli). Son compte est
alors partagé avec ton portefeuille. **Seul un partenaire de Meta (Tech Provider) peut proposer ce parcours.**

## 3. Faut-il l'Embedded Signup et le statut Tech Provider ?

**Oui**, dès que tu veux signer des restos qui gardent leur numéro, c'est-à-dire presque tous. Sans lui, chaque
nouveau client demande soit un nouveau numéro (voie 1), soit un prestataire payant comme UChat.

### Ce que ça demande (côté Meta, fait par toi)

| Étape | Durée (estimée) | Remarque |
|---|---|---|
| **Vérification de l'entreprise** PFlow 1 (avis SIRENE, site pflow.fr) | quelques jours | Peut-être déjà faite, à vérifier dans Paramètres de l'entreprise, puis Centre de sécurité. Elle sert aussi aux limites d'envoi. |
| **App Review** de PFlow Bots : accès avancé à `whatsapp_business_management` et `whatsapp_business_messaging` | quelques jours à 2 semaines | Vidéos d'écran demandées : un message envoyé depuis l'app, un modèle créé. |
| Statut **Tech Provider** (conditions à accepter ; « vérification d'accès » selon les sources) | jusqu'à ≈ 5 jours ouvrés | Les sources se contredisent sur cette étape, encore exigée ou non : à voir dans le tableau de bord de l'app. |
| Configuration **Facebook Login for Business** de type « WhatsApp Embedded Signup », **v4** (v2 et v3 arrêtées le 15 octobre 2026), avec l'option coexistence | 30 min | Dans l'app PFlow Bots. |

**Total** : 1 à 3 semaines de délai chez Meta, pour quelques heures de travail de ta part. Tout cela peut se
lancer **sans code**, dès maintenant.

### Ce qu'il faudra coder (estimation)

| Partie | Effort |
|---|---|
| Page « Connecter votre WhatsApp », envoyée par lien au gérant : SDK JavaScript de Meta, bouton qui ouvre l'Embedded Signup v4 en coexistence | 1 jour |
| Route de retour : échange du code contre un jeton d'entreprise, lecture des IDs du compte et du numéro, abonnement de PFlow Bots, **création automatique du canal en test** relié au resto | 1 jour |
| Stockage chiffré du jeton de chaque client (nouvelle table `bot_`, SQL à montrer), envoi avec le bon jeton par canal | 1 jour |
| Page État : canaux arrivés par l'Embedded Signup, erreurs, bouton pour renvoyer le lien ; tests | 1 jour |
| Essai réel avec un numéro (le tien ou un client volontaire) | ½ jour |

**≈ 4 à 5 jours de développement**, après l'accord de Meta. Le développement peut commencer avant, en mode
« développement » de l'app : seuls tes comptes de test pourront alors s'inscrire.

**Paiement** : en tant que Tech Provider, tu ne peux pas partager ta propre ligne de crédit, qui est réservée aux
Solution Partners. Le client ajoute **sa carte** dans le parcours, ou tu ajoutes la tienne sur son compte de
messagerie et tu refactures. À trancher : je recommande que **le client paie Meta directement**, c'est plus simple
et sans avance de frais.

## 4. Recommandation

1. **Maintenant (sans code)** :
   - vérifier ou lancer la vérification de l'entreprise ;
   - préparer l'App Review (vidéos) ;
   - demander le statut Tech Provider.

   Ces délais chez Meta sont le vrai goulot.
2. **Après la migration des 3 clients (après le 21)** : coder l'Embedded Signup v4 avec coexistence et la création
   automatique du canal (≈ 4 à 5 jours).
3. **En attendant**, pour un resto signé entre-temps :
   - s'il accepte un **numéro dédié**, voie 1 ;
   - sinon, on prépare tout (carte, bot, fiche, tests au simulateur) et on branche son numéro dès que l'Embedded
     Signup est prêt.
4. **Petit plus utile (≈ ½ jour)** : un écran « Ajouter un canal » sur la page État, à la place du SQL à la main
   (étape 6).

Sources :
- [Meta : Embedded Signup, mise en œuvre (v2/v3 arrêtées le 15 octobre 2026)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Twilio : guide du programme Tech Provider (vérification d'accès ≈ 5 jours ouvrés)](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
- [Infobip : étapes du programme Tech Provider](https://www.infobip.com/docs/whatsapp/tech-provider-program/setup-and-integration)
- [Telnyx : Embedded Signup en Tech Provider](https://developers.telnyx.com/docs/messaging/whatsapp/embedded-signup/tech-provider)
- [Meta : gérer les lignes de crédit](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines)

Les délais et l'étape de « vérification d'accès » viennent de prestataires, pas de Meta : à confirmer dans le
tableau de bord de l'app.
