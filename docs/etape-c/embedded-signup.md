# « Connecter votre WhatsApp » : Embedded Signup v4 avec coexistence (9 novembre 2026)

Pour les **nouveaux clients** : le gérant connecte lui-même le numéro de son resto à PFlow Bots, **en gardant son appli
WhatsApp Business** (coexistence), et paie Meta avec **sa propre carte**. Remplace ce que faisait UChat (Smart Link).

Sources Meta lues le 9 novembre 2026, par extraits de recherche : le réseau de la session ne donne pas accès à
developers.facebook.com. Ce qui n'est pas confirmé mot pour mot est marqué **à vérifier** ; liens en bas de page.

## 1. Ce qui est construit (PR « Embedded Signup »)

| Élément | Où |
|---|---|
| Lien unique et expirant (7 jours) pour un resto du CRM, créé depuis la page **État** → « Connecter le WhatsApp d'un resto » ; seule l'empreinte du lien est gardée | `src/app/api/connexions-whatsapp/route.ts`, `src/components/connexions-whatsapp-card.tsx` |
| Page publique **« Connecter votre WhatsApp »** (`/connecter/<lien>`), aux couleurs PFlow, sans compte : ce qu'il faut avoir, les étapes, le bouton qui ouvre l'Embedded Signup v4 en coexistence (`featureType: whatsapp_business_app_onboarding`), puis **« Dernière étape : votre carte chez Meta »** | `src/app/connecter/[jeton]/page.tsx` |
| Fin du parcours, côté serveur, dans l'ordre : code → **jeton du client**, jeton **chiffré** (AES-256-GCM), lecture du numéro, **abonnement de l'app** aux webhooks du compte du client, **synchronisation des contacts puis de l'historique** (coexistence, une seule fois, dans les 24 h), **canal créé en « test »**, **les 10 modèles de la livraison** créés sur le compte du client (ceux qui existent déjà sont laissés) | `src/channels/whatsapp/embedded-signup.ts`, `src/app/api/connecter/[jeton]/route.ts` |
| Jamais d'enregistrement du numéro (`/register`) en coexistence (il l'est déjà par l'appli). Si le gérant prend le parcours classique (son numéro quitte l'appli), c'est noté : enregistrement avec PIN à faire avec lui | idem |
| Envoi : chaque numéro connecté envoie avec **le jeton de son client** (déchiffré à la volée, cache 5 min) ; les autres avec le jeton général de PFlow | `src/channels/whatsapp/graph.ts`, `src/channels/core/runtime.ts` |
| Page **État** : connexions en cours, terminées, abandonnées (étape et session Meta notées), en erreur, avec le déroulé étape par étape | `src/components/connexions-whatsapp-card.tsx` |
| Tests (faux Meta) : chiffrement, 10 modèles, ordre des appels, jeton jamais en clair, canal sans doublon, code refusé, parcours classique, routes, envoi avec le jeton du client | `src/channels/whatsapp/__tests__/embedded-signup.test.ts` |

Captures : `docs/captures/embedded-signup/connecter-iphone.png`, `page-etat.png`.

**Sécurité** : le jeton du client n'est jamais en clair en base, dans une réponse, dans un journal ni dans Git. La
clé de chiffrement n'est que dans Vercel. Le secret de l'app sert seulement à l'échange du code (côté serveur). La page
publique ne reçoit que l'identifiant de l'app et de la configuration (pas des secrets). Le canal est toujours créé en
**test** : c'est toi qui le passes en actif.

## 2. À faire de ton côté (dans l'ordre)

### 2.1 Base et variables (avant la vidéo)

1. **SQL** à valider : `supabase/migrations/20261111000000_bot_connexions_whatsapp.sql` (2 tables `bot_`, RLS ; la table
   des jetons n'a aucune règle : seul le serveur y accède). Rien d'autre n'est modifié.
2. **Variables Vercel** (projet `pflow-bot-app`, Production) :
   - `BOT_JETONS_CLE` : sur ton ordinateur `openssl rand -base64 32`, coller le résultat dans Vercel (type
     « Sensitive »). **Jamais dans le chat.** La perdre = reconnecter les clients ; la garder aussi dans ton
     gestionnaire de mots de passe ;
   - `META_APP_ID` : l'identifiant de l'app Meta PFlow Bots (pas un secret) ;
   - `META_ES_CONFIG_ID` : l'identifiant de la configuration Embedded Signup v4 (étape 2.2.4, pas un secret) ;
   - `WHATSAPP_APP_SECRET` : déjà là (c'est le secret de la même app Meta).
3. Redéployer. La page État affiche « Pas encore prêt » tant qu'une variable manque.

### 2.2 Chez Meta, pour que la demande d'examen parte le plus tôt possible

1. **Vérification d'entreprise** du portefeuille PFlow (Kbis/SIRET, domaine, adresse) : quelques jours. *À lancer
   en premier si ce n'est pas fait.*
2. **Paramètres de l'app** (App Dashboard → Paramètres → Général) : URL de politique de confidentialité
   (`https://pflow.fr/confidentialite` ou la page Bots), URL de suppression des données (`/suppression-donnees`),
   icône 1024 × 1024 (le P en verre liquide), catégorie (Business / Messagerie, *à vérifier*), e-mail de contact, app
   rattachée au portefeuille PFlow vérifié.
3. **Facebook Login for Business → Paramètres** : activer « Login with the JavaScript SDK » ; domaines autorisés du
   SDK JavaScript : `https://pflow-bot-app.vercel.app` (et le futur domaine) ; URI de redirection OAuth valides :
   `https://pflow-bot-app.vercel.app/connecter/`.
4. **Facebook Login for Business → Configurations → Créer** : variante **« WhatsApp Embedded Signup »** (v4),
   produit **WhatsApp Cloud API**, jeton **d'utilisateur système** avec expiration **« Jamais »** (non modifiable
   ensuite), ressources : comptes WhatsApp (gérer), autorisations `whatsapp_business_management` et
   `whatsapp_business_messaging`. Noter le **config_id** → `META_ES_CONFIG_ID`. (Pas d'interrupteur « coexistence » :
   elle passe par la page, *à vérifier dans l'« Embedded Signup Builder »*.)
5. **Webhook WhatsApp** (déjà en place) : ajouter les champs `smb_message_echoes`, `smb_app_state_sync`, `history`,
   `account_update`, `message_template_status_update` (en plus de `messages`).
6. **Révision → Tests** : au moins un appel réussi pour chaque autorisation (fait par l'app : envoi d'un message,
   lecture/création d'un modèle). Les compteurs peuvent mettre 24 h à apparaître.
7. **Devenir Tech Provider** (page « Become a Tech Provider » du tableau de bord) ; la « vérification d'accès »
   séparée aurait été supprimée en octobre 2025, *à vérifier dans Révision → Vérification*.
8. **App Review**, accès avancé pour `whatsapp_business_messaging` et `whatsapp_business_management` (rien d'autre :
   une autorisation en trop est une cause de refus fréquente). **Une vidéo par autorisation** (voir 2.3). Bien cliquer
   **« Soumettre »**. Délai : quelques jours à environ 2 semaines.

### 2.3 Avant l'examen : le mode « mes propres comptes » (pour tourner les vidéos)

En mode développement, l'Embedded Signup marche pour toute personne qui a un **rôle sur l'app** (admin, développeur,
testeur). Donc **le même code** tourne dès maintenant avec tes comptes, sans attendre l'examen :

1. Un **portefeuille de test distinct** de celui de l'app (un onboarding dans le même portefeuille échoue chez
   certains développeurs), dont ton compte Facebook est admin.
2. Un **vrai numéro WhatsApp Business** utilisé dans l'appli depuis au moins 7 jours (pas PFlow Démo, pas un numéro de
   client). L'appli WhatsApp Business ≥ 2.24.17.
3. Page État → créer un lien pour un resto de test → ouvrir le lien → connecter.
4. **Vidéo 1 (`whatsapp_business_management`)** : la page État, le lien, le parcours Embedded Signup, la fin (étapes
   ✅), puis WhatsApp Manager où apparaissent les **modèles de livraison créés** par PFlow Bots.
5. **Vidéo 2 (`whatsapp_business_messaging`)** : dans la boîte de réception PFlow Bots, une réponse envoyée au numéro de
   test, et le message **reçu dans WhatsApp** sur le téléphone.
6. En anglais ou sous-titrées, une autorisation par vidéo, filmées côté PFlow.

Sans accès avancé, un vrai client (sans rôle sur l'app) voit l'erreur `#2655111` : c'est normal avant l'examen.

## 2 bis. Les 10 modèles de la livraison, compte par compte

Le diagnostic du 9 novembre a montré que le compte 1808772226929443 répond « Authorization Error » au jeton de
pflow-bots-serveur : **ce n'est pas un compte commun utilisable**. Chaque resto a son compte WhatsApp (son compte de
messagerie), et un modèle appartient à un compte : il faut **les 10 modèles sur le compte de chaque resto**.

- **Page État → « Modèles WhatsApp de la livraison (par compte) »** (après fusion) : pour chaque canal de resto, le
  statut des 10 chez Meta, un bouton « Créer les N manquants » par compte, et « Créer les manquants sur tous les
  comptes ». Identifiant utilisé : le compte de messagerie du canal s'il est connu (nouveau modèle de Meta), sinon le
  WABA ; jeton : celui du client (resto connecté par l'Embedded Signup) ou le jeton général. Jamais de modification
  d'un modèle existant.
- Les restos connectés par l'Embedded Signup les reçoivent **automatiquement** à la fin de la connexion.
- Pour ag pizza, Mexico Sainte-Rose et Cookies An Nou : d'abord leurs canaux (diagnostic avec les IDs saisis, SQL à
  valider), puis le bouton.
- **À la main** (sans attendre) : dans WhatsApp Manager **de chaque compte**, Modèles de message → Créer : catégorie
  Utilitaire, nom exact, langue Français (`fr`), corps exact, variables « Nombre » avec les exemples, bouton « Accéder
  au site web » « Suivre ma livraison », URL dynamique `https://order.pflow.fr/suivi/{{1}}`. Textes :
  `docs/livraison/GUIDE-MODELES-WHATSAPP.md` (branche Livraison du CRM), identiques au mot près (vérifié).
- Réponse de Meta : quelques heures, parfois 1 à 2 jours ; un refus s'affiche avec son motif.
- **Pour la route de livraison** (à construire) : le modèle se cherche sur le compte du canal du resto.

## 2 ter. La vidéo de l'examen avec le numéro de Cedyan Energy

**Qui fait le parcours : toi**, avec ton compte Facebook.
- Ton compte a déjà un rôle sur l'app PFlow Bots (admin) : en mode développement, l'Embedded Signup marche pour lui.
- Il doit être **administrateur (contrôle total) du portefeuille Meta de Cedyan** : ton père t'ajoute dans
  business.facebook.com → Paramètres → Utilisateurs → Personnes → Ajouter → ton e-mail → accès **Contrôle total**
  (admin) → tu acceptes l'invitation.
- Le **téléphone de Cedyan** (appli WhatsApp Business à jour) doit être à côté de toi : Meta demande une
  confirmation dans l'appli (code ou QR code) pendant le parcours.
- Variante : ton père le fait lui-même. Il faut alors l'ajouter comme **testeur** de l'app (App Dashboard → Rôles de
  l'app → Testeurs → son compte Facebook ; il accepte dans developers.facebook.com → Demandes) : plus long, et la
  vidéo doit de toute façon montrer PFlow Bots, donc c'est plus simple que ce soit toi.

**Préparer** :
1. PR n° 17 fusionnée, SQL appliqué, variables Vercel (dont `META_ES_CONFIG_ID`), domaine et configuration v4 faits.
2. Page État → « Lien pour un client test » → « Cedyan Energy » : identifiant propre, **relié à aucun resto**
   (rien côté CRM ni PFlow Order).
3. À la fin, le canal est **en test** avec **ton seul numéro (590690938108)** en liste de test : aucune réponse
   automatique aux vrais clients de Cedyan. (Et comme il n'est relié à aucun resto, il n'a pas de bot : il ne répond
   à personne ; tu peux répondre à la main depuis la boîte de réception.)

**Déroulé de la vidéo `whatsapp_business_management`** (environ 2 min, écran d'ordinateur, sous-titres en anglais) :
1. **PFlow Bots → page État**, carte « Connecter le WhatsApp d'un resto » : saisir « Cedyan Energy », « Lien pour un
   client test », le lien s'affiche. *L'examinateur voit : l'outil de PFlow qui lance l'onboarding d'un client.*
2. **Ouvrir le lien** : la page « Connecter votre WhatsApp » (nom « Cedyan Energy », étapes, bouton). *Il voit : ce que
   reçoit le client, en clair.*
3. **« Connecter mon WhatsApp »** → fenêtre Meta : **connexion Facebook** (ton compte). *Il voit : le login Facebook
   officiel (Facebook Login for Business).*
4. **Choix du portefeuille** : celui de Cedyan Energy. *Il voit : le client choisit son propre portefeuille.*
5. **Connecter l'appli WhatsApp Business** : choix du **numéro de Cedyan**, confirmation dans l'appli sur le téléphone
   (filmer le téléphone un instant, ou le dire en sous-titre). *Il voit : la coexistence, le numéro du client.*
6. **Autorisations** demandées par PFlow Bots (gestion du compte WhatsApp, messagerie) → Confirmer. *Il voit : la
   permission whatsapp_business_management demandée et accordée.*
7. **Fin du parcours** : retour sur la page, « C'est connecté ✅ », le numéro, la liste des étapes (accès gardé,
   réception des messages, contacts, conversations, bot en test, messages de suivi de livraison), puis « Dernière étape :
   votre carte chez Meta ». *Il voit : ce que PFlow fait avec la permission.*
8. **Retour sur PFlow Bots → page État** : la connexion « Connecté (canal en test) », le déroulé ; la carte « Canaux »
   avec le **canal créé** (numéro de Cedyan, état test). *Il voit : le compte du client géré dans PFlow Bots.*
9. **Carte « Modèles WhatsApp de la livraison (par compte) »** : le compte de Cedyan avec les 10 modèles **créés par
   PFlow Bots** (« En examen ») ; puis WhatsApp Manager de Cedyan → Modèles de message, où ils apparaissent. *Il voit :
   la création de modèles, cœur de whatsapp_business_management.*

**Vidéo `whatsapp_business_messaging`** (séparée, environ 1 min) : depuis ton téléphone (590690938108), écrire au
numéro de Cedyan ; dans PFlow Bots → boîte de réception, ouvrir la conversation, répondre ; montrer la réponse
**reçue dans WhatsApp** sur ton téléphone.

**Débrancher Cedyan après la vidéo** (si tu veux) :
1. **PFlow Bots → page État** → la connexion Cedyan → « Débrancher ce numéro » : l'app est désabonnée du compte de
   Cedyan, le canal est coupé (le bot ne répond plus à personne) et le jeton est effacé. Les modèles créés restent sur
   le compte de Cedyan (sans effet ; ton père peut les supprimer dans WhatsApp Manager).
2. **Côté Meta** (pour retirer tout accès) : business.facebook.com de Cedyan → Paramètres → **Partenaires** (ou
   Intégrations → Applications connectées) → retirer PFlow Bots / PFlow.
3. **Dans l'appli WhatsApp Business** de Cedyan : rien à faire, le numéro reste dans l'appli. Pour couper aussi
   l'API : Paramètres → Compte → Plateforme Business (intitulé *à vérifier*) → Déconnecter. Les conversations restent.

## 2 quater. Faut-il l'autorisation `business_management` sur le jeton de pflow-bots-serveur ?

**Non, pas maintenant.** Elle sert seulement à **lister** les entreprises et leurs comptes (`me/businesses`, d'où
l'erreur « Missing Permission » du diagnostic). Envoyer, lire les numéros, s'abonner, créer des modèles se fait **avec
l'ID du compte**, et le diagnostic accepte maintenant des IDs saisis à la main (PR « diagnostic »). Si un compte saisi
répond lui aussi « permission » (et pas seulement la liste des entreprises), alors :
1. Business Manager → Utilisateurs système → pflow-bots-serveur → Générer un nouveau jeton, avec
   `whatsapp_business_management`, `whatsapp_business_messaging` et `business_management` ;
2. Vercel → `WHATSAPP_TOKEN` = le nouveau jeton (Sensitive) → redéployer ;
3. l'ancien jeton reste valide jusqu'à ce que tu le révoques (même écran) : le révoquer une fois le nouveau vérifié.
Inconvénient : une autorisation de plus sur un jeton permanent (accès à tout le portefeuille).

## 2 quinquies. Configuration Meta (10 novembre 2026) : jeton de 60 jours et tâches

Configuration créée par Jules depuis le modèle Meta « inscription intégrée à WhatsApp avec un token d'expiration de
60 jours ». Elle donne un jeton d'utilisateur système d'intégration métier ; l'expiration de 60 jours est imposée
par le modèle. Produit : WhatsApp Cloud API seul. Comptes WhatsApp avec les tâches MANAGE, DEVELOP, MANAGE_TEMPLATES,
VIEW_PHONE_ASSETS, MANAGE_PHONE_ASSETS, VIEW_TEMPLATES et MESSAGING. L'ID de configuration va dans
`META_ES_CONFIG_ID` (Vercel, Production).

### Le jeton expire-t-il vraiment au bout de 60 jours ?

Oui, d'après Meta : un jeton d'utilisateur système qui expire « est valable 60 jours à partir de sa création ou de son
dernier renouvellement » ; sans renouvellement, il est perdu et il faut en obtenir un nouveau (doc Meta « Install
Apps, Generate, Refresh, and Revoke Tokens »). Ce que fait PFlow Bots :

- **À la connexion** : l'échéance est lue (champ `expires_in` de Meta, sinon `debug_token`) et gardée avec le jeton
  (`bot_jetons_whatsapp.expire_le`). Le déroulé de la connexion note « expire le … » et les droits réellement
  accordés (`whatsapp_business_management`, `whatsapp_business_messaging`).
- **Chaque jour à 6 h 43 (UTC)** (`/api/cron/jetons`, Vercel Cron) : un jeton à moins de 20 jours de son échéance est
  renouvelé par l'API de Meta (`GET oauth/access_token`, `grant_type=fb_exchange_token`,
  `set_token_expires_in_60_days=true`) : nouveau jeton de 60 jours, chiffré, l'ancien reste valable jusqu'à sa propre
  échéance. Soit 19 essais avant l'échéance si Meta refuse.
- **Si le renouvellement échoue** : l'erreur est gardée. À moins de 10 jours, le bandeau rouge de la page État et
  l'encadré « Connecter le WhatsApp d'un resto » l'affichent, avec un bouton **« Lien de reconnexion »** : un nouveau
  lien (7 jours) à envoyer au gérant. Il refait le parcours (5 minutes) et un nouveau jeton de 60 jours remplace
  l'ancien, sans rien perdre (même compte, même canal).
- **« Renouveler maintenant »** (page État) : renouvelle tout de suite le jeton d'un resto. À faire **une fois, dès le
  premier resto connecté**, pour vérifier que Meta accepte le renouvellement des jetons d'intégration métier (la doc
  de Meta le décrit pour les jetons d'utilisateur système, sans parler explicitement de ceux de l'Embedded Signup).
  Si Meta refuse, il reste la reconnexion tous les 60 jours (l'alerte est là pour ça), ou une configuration sans
  expiration si Meta en propose une plus tard.

Migration : `supabase/migrations/20261112000000_bot_jetons_expiration.sql` (4 colonnes ajoutées à
`bot_jetons_whatsapp`). Sans elle, la connexion marche toujours, mais l'échéance n'est pas gardée.

### Les tâches suffisent-elles ?

| Ce que fait PFlow Bots | Appel Meta | Droit et tâche |
|---|---|---|
| Lire le numéro du resto | `GET /{numéro}` | `whatsapp_business_management`, VIEW_PHONE_ASSETS |
| Abonner l'app au compte (recevoir les messages) et la désabonner | `POST` / `DELETE /{compte}/subscribed_apps` | `whatsapp_business_management`, MANAGE |
| Coexistence : contacts et historique de l'appli | `POST /{numéro}/smb_app_data` | `whatsapp_business_management`, MANAGE_PHONE_ASSETS |
| Lister et créer les 10 modèles de la livraison | `GET` / `POST /{compte}/message_templates` | `whatsapp_business_management`, VIEW_TEMPLATES, MANAGE_TEMPLATES |
| Envoyer les messages, marquer comme lu, télécharger les vocaux | `POST /{numéro}/messages`, `GET /{média}` | `whatsapp_business_messaging`, MESSAGING |
| Recevoir les messages et les échos de l'appli | webhooks de l'app (champs `messages`, `smb_message_echoes`…) | abonnement ci-dessus ; champs réglés dans l'app Meta |

Toutes les actions de PFlow Bots sont couvertes. Ce qui n'est pas demandé, et n'est pas nécessaire :
`business_management` (voir 2 quater), l'enregistrement du numéro (`/register`, jamais en coexistence), la
modification du profil WhatsApp du resto, et le partage d'une ligne de crédit (chaque resto paie Meta avec sa propre
carte). Contrôle réel : à la première connexion, l'étape « jeton_droits » du déroulé doit être ✅ avec les deux droits.

## 3. Ce qu'il faut dire aux restos (coexistence)

- Garder l'appli **WhatsApp Business** à jour et **l'ouvrir au moins une fois toutes les 2 semaines** (sinon Meta coupe
  l'API sur ce numéro).
- Numéro utilisé dans l'appli depuis **au moins 7 jours** ; ne pas l'ajouter soi-même dans un portefeuille avant.
- Dans l'appli : plus de **listes de diffusion**, de **messages éphémères** ni de **vue unique** ; les appareils liés sont
  déconnectés (on peut en re-lier certains) ; les groupes restent dans l'appli seulement. *Liste exacte à vérifier.*
- Ce qu'il envoie depuis l'appli reste gratuit ; ce que le bot envoie est facturé par Meta **sur sa carte**.
- Guadeloupe (+590, France / UE) : a priori éligible (UE ouverte depuis octobre 2025), **aucune mention explicite
  trouvée : à vérifier au premier essai réel**.
- Débit API : 20 messages par seconde en coexistence (largement assez).

## 4. Points d'attention

- **Contrat livraison** (`INTERFACE-PFLOW-BOTS.md`, version du commit ad59937) : il dit que tous les numéros sont dans
  **ton** compte WhatsApp Business, et que les 10 modèles s'y créent une fois. Le diagnostic montre que non : un compte
  par resto. Les modèles se créent donc compte par compte (2 bis). C'est vrai pour les restos migrés dans ton
  compte. Un resto connecté par **l'Embedded Signup** garde **son propre** compte (qu'il paie) : les 10 modèles doivent
  exister sur **son** compte. C'est ce que fait l'étape 7 automatiquement. La route de livraison devra donc chercher le
  modèle sur le compte du canal du resto.
- **Tarifs Meta** : plusieurs sources indiquent que depuis le **1er octobre 2026** les messages de service (texte libre
  dans la fenêtre de 24 h) sont **facturés** au tarif utility, et que la franchise de « 1 000 messages de service
  gratuits par mois » n'est pas certaine. **À vérifier** sur la page de tarification de Meta : le contrat livraison et
  la base de la démo s'appuient sur l'ancienne règle.
- **Quotas** : 10 nouveaux clients par 7 jours glissants tant que l'entreprise n'est pas vérifiée (*à vérifier*).
- **Jeton qui expire** : avec l'expiration « Jamais » (étape 2.2.4), rien à renouveler. Sinon (60 jours), il faudra
  refaire le lien.

## Sources

- Meta, « Install Apps, Generate, Refresh, and Revoke Tokens » (jetons d'utilisateur système de 60 jours et leur renouvellement) : https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/
- Meta, « Access Tokens » (jetons d'utilisateur système d'intégration métier, obtenus par l'Embedded Signup) : https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/

- Meta, versions de l'Embedded Signup : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/
- Meta, Embedded Signup v4 (blog, 14 mai 2026) : https://developers.facebook.com/blog/post/2026/05/14/embedded-signup-v4/
- Meta, mise en œuvre : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
- Meta, coexistence (utilisateurs de l'appli WhatsApp Business) : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta, Tech Provider : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Meta, App Review : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Meta, tarification : https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- 360dialog, coexistence : https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence
- Twilio, programme Tech Provider : https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
