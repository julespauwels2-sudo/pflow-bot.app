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

## 2 bis. Les 10 modèles de la livraison sur TON compte (une seule fois)

Contrat livraison (version du commit ad59937) : les 10 modèles se créent **une fois** sur ton compte WhatsApp Business
commun (celui de tous tes numéros). En base, le compte du numéro PFlow Démo est le **1808772226929443** : c'est
celui-là, sauf si tu me dis le contraire. Textes : identiques au mot près à `docs/livraison/GUIDE-MODELES-WHATSAPP.md`
(vérifié automatiquement le 9 novembre).

- **Par l'API, en un clic (après fusion de cette PR)** : page **État** → « Modèles WhatsApp de la livraison » → « Voir
  les modèles » (statut de chacun chez Meta) → « Créer les N manquants et les soumettre ». Le serveur utilise le jeton
  général déjà dans Vercel (`WHATSAPP_TOKEN`) ; un modèle existant n'est jamais modifié. Il faut que ce jeton ait
  l'autorisation `whatsapp_business_management` sur ce compte (c'est le cas d'un jeton d'utilisateur système « Admin »
  créé avec les deux autorisations WhatsApp ; sinon Meta répond une erreur de permission, affichée telle quelle).
- **À la main (sans attendre la fusion)** : business.facebook.com → ton portefeuille → WhatsApp Manager → Gestion des
  comptes → **Modèles de message** → Créer un modèle, puis pour chacun : catégorie **Utilitaire**, nom exact, langue
  **Français** (code `fr`), corps exact, variables de type « Nombre » avec les exemples du guide, bouton **Accéder au
  site web** « Suivre ma livraison », URL **dynamique** `https://order.pflow.fr/suivi/{{1}}`, exemple
  `https://order.pflow.fr/suivi/0b6f2c1e-1111-4222-8333-444455556666`, puis **Envoyer**. Pas à pas complet :
  `docs/livraison/GUIDE-MODELES-WHATSAPP.md` (branche Livraison du CRM).
- Réponse de Meta : souvent quelques heures, parfois 1 à 2 jours. Un refus s'affiche avec son motif sur la page État.

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
  **ton** compte WhatsApp Business, et que les 10 modèles s'y créent une fois. C'est vrai pour les restos migrés dans ton
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

- Meta, versions de l'Embedded Signup : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/
- Meta, Embedded Signup v4 (blog, 14 mai 2026) : https://developers.facebook.com/blog/post/2026/05/14/embedded-signup-v4/
- Meta, mise en œuvre : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
- Meta, coexistence (utilisateurs de l'appli WhatsApp Business) : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta, Tech Provider : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Meta, App Review : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Meta, tarification : https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- 360dialog, coexistence : https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence
- Twilio, programme Tech Provider : https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
