# Diagnostic des numéros avant la bascule (C6)

Préparé le 8 novembre 2026. But : savoir, **numéro par numéro**, dans quel cas on est (A, B ou C du
`guide-c6-bascule.md`) et dans quel ordre basculer. **Lecture seule** : rien n'est modifié chez Meta.

Numéros : **ag pizza** et **Mexico Sainte-Rose** (numéros perso des gérants, qui gardent leur appli),
**Cookies An Nou**, **PFlow Démo** (+590 691 26 68 53), **ton numéro perso**. Tous gérés aujourd'hui par
UChat, dans ton portefeuille « PFlow 1 ».

## Règle d'or : ne jamais afficher de token

Dans l'explorateur de l'API Graph, le champ « Token d'accès » contient un token : **ne le copie nulle part,
ne fais pas de capture d'écran qui le montre**. Copie seulement les **résultats** (le JSON à droite). Les
ID qu'on y lit (WABA, numéro, entreprise) ne sont pas des secrets : tu peux me les envoyer.

## 1. Les écrans de Meta (10 min, sans rien taper)

**a. Paramètres de l'entreprise** (business.facebook.com/settings, portefeuille **PFlow 1**) → **Comptes →
Comptes WhatsApp**. Pour chaque compte de la liste, note :
- son **nom** et son **ID** (= le WABA) ;
- l'onglet **Propriétaire** / « Détenu par » : **PFlow 1** ou une autre entreprise (UChat, le resto…) ;
- l'onglet **Partenaires** : UChat y apparaît-il ? (= UChat a accès) ;
- s'il existe aussi un **compte de messagerie** (« Messaging account ») rattaché, comme pour le numéro de test.

**b. WhatsApp Manager** (business.facebook.com/wa/manage) → choisir chaque compte → **Numéros de
téléphone**. Pour chaque numéro, note :
- le **statut** (Connecté, En attente…) ;
- la mention **« WhatsApp Business app »** / **Coexistence** (le gérant utilise encore l'appli) ;
- l'**ID du numéro** (Phone number ID, dans les détails du numéro).

## 2. Les mêmes informations par l'explorateur de l'API Graph (plus précis)

developers.facebook.com/tools/explorer → en haut à droite : app **PFlow Bots**, **Token d'utilisateur**
(ton compte, admin de PFlow 1), autorisations **`business_management`** et **`whatsapp_business_management`**
→ **Générer le token** (ne le copie pas). Puis, une requête à la fois (méthode GET) :

| # | Requête | Ce qu'elle dit |
|---|---|---|
| 1 | `me/businesses?fields=id,name` | L'**ID de l'entreprise** PFlow 1 |
| 2 | `<ID_PFLOW_1>/owned_whatsapp_business_accounts?fields=id,name` | Les comptes WhatsApp **détenus par PFlow 1** |
| 3 | `<ID_PFLOW_1>/client_whatsapp_business_accounts?fields=id,name` | Les comptes **d'autres entreprises** partagés avec PFlow 1 |
| 4 | `<WABA_ID>/phone_numbers?fields=id,display_phone_number,verified_name,status,platform_type,is_on_biz_app` | Pour chaque compte : ses numéros. **`platform_type`** = `CLOUD_API` (sur l'API) ou `NOT_APPLICABLE` (pas sur l'API) ; **`is_on_biz_app`** = `true` (coexistence : l'appli reste active) |
| 5 | `<WABA_ID>/subscribed_apps` | Les apps qui reçoivent les messages (UChat aujourd'hui ; PFlow Bots plus tard) |

Si Meta répond « Invalid parameter » à la requête 4, retire `is_on_biz_app` puis `platform_type` et
recommence (le nouveau modèle de comptes refuse parfois certains champs) : l'écran WhatsApp Manager (1.b)
donne alors l'information.

## 3. Lire le résultat : le cas de chaque numéro

| Ce que tu vois | Cas | Ce qu'on fera |
|---|---|---|
| Compte dans la requête **2** (détenu par PFlow 1), numéro en **`CLOUD_API`** | **A** | Attribuer le compte (et le compte de messagerie) à `pflow-bots-serveur`, abonner PFlow Bots, canal en test. Rien à réenregistrer. Si `is_on_biz_app: true` : coexistence, l'appli du gérant continue de marcher. |
| Compte seulement dans la requête **3** (détenu par une autre entreprise, ex. UChat) | **B** | Le propriétaire doit partager le compte avec PFlow 1 (ou le transférer). On en parle avant. |
| Numéro absent des requêtes 2 et 3, ou `platform_type: NOT_APPLICABLE` | **C** | Pas encore sur l'API : il faudra l'Embedded Signup (pas codé). |

⚠️ **Plusieurs numéros dans le même compte WhatsApp** (ex. ton numéro perso avec un client) : l'abonnement
de l'app se fait **par compte**. PFlow Bots recevra donc les messages de tous ses numéros. Depuis le
8 novembre, un message pour un numéro **sans canal** est ignoré **sans rien enregistrer** (ni texte ni
numéro). Ton numéro perso ne sera jamais un canal.

## 4. Ordre de bascule recommandé

1. **PFlow Démo** (+590 691 26 68 53), en premier.
   - Aucun client réel ni aucune vraie commande : rôle « pflow », les événements de commande ne le visent
     jamais.
   - Il valide toute la procédure sur un vrai numéro (attribution des comptes, abonnement, compte de
     messagerie, coexistence si l'appli est active) **sans aucun risque**.
2. **Cookies An Nou**, ensuite.
   - Bot entièrement réglé et testé sur le numéro de test (accueil, IA, commandes, suivi, annulation).
   - Mode « toujours ». Les vrais événements de commande ne basculent qu'au passage en « actif ».
3. **Mexico Sainte-Rose** et **ag pizza**, en dernier.
   - Ce sont les **numéros perso des gérants**, en coexistence : le bot doit se taire dès que le gérant
     écrit lui-même (pause de 12 h, à vérifier en conditions réelles avec PFlow Démo d'abord).
   - Leurs bots sont en mode « mots-clés uniquement » : le bot ne répond qu'aux mots-clés, jamais aux
     messages privés du gérant.
   - ag pizza a sa propre copie de l'Accueil, à relier au modèle avant (voir `docs/plan.md`).
4. **Ton numéro perso** : jamais (il sert de numéro de test).

## 5. Ce que tu m'envoies

Pour chaque numéro : le **nom du compte WhatsApp**, son **ID (WABA)**, l'**ID du numéro**, le
**propriétaire** (PFlow 1 ou autre), **`platform_type`**, **`is_on_biz_app`**, et les apps de la
requête 5. Avec ça, je te dis le cas de chacun et je prépare les lignes de canal (SQL) prêtes à jouer.
