# Examen de l'app Meta (10 novembre 2026) : vidéos sans Embedded Signup

## Pourquoi l'Embedded Signup est bloqué

Au lancement, la fenêtre de Meta affiche « PFlow 1 ne peut pas intégrer de clients pour le moment ». Ce message vient
du **statut de l'app chez Meta**, pas de la configuration de PFlow Bots :

- Meta : *« you will not be able to onboard business customers until your app has been approved for advanced access
  for each of the permissions it requires »*. Tant que l'examen de `whatsapp_business_management` et
  `whatsapp_business_messaging` n'est pas validé (accès avancé), et que la vérification Tech Provider n'est pas
  terminée, l'Embedded Signup refuse les clients d'un autre portefeuille (Cedyan Energy SAS compris).
- Le même message existe pour une « solution » (partenaire de solution) inactive. PFlow Bots n'en utilise pas : la
  configuration n'a pas d'identifiant de solution, ce cas ne nous concerne pas.
- Notre configuration est complète (META_APP_ID, META_ES_CONFIG_ID, secret, clé des jetons, champs du webhook) : le
  message apparaît avant toute étape de PFlow Bots ; aucun appel n'arrive chez nous.
- « Continuer en tant que Jules » puis une connexion sans numéro : en mode « mes propres comptes », Meta laisse ouvrir
  la fenêtre mais aucun compte WhatsApp n'a été choisi ou partagé ; c'est le même blocage, pas un défaut de la page.

Conséquence : les deux vidéos de l'examen se font **sans Embedded Signup**, sur les comptes de PFlow (portefeuille de
Jules, numéro PFlow Démo), avec ce que PFlow Bots sait déjà faire. L'Embedded Signup sera montré après validation.

## Préparation (une fois, avant de filmer)

- Ordinateur, navigateur en anglais si possible (Meta préfère), zoom à 110 %, notifications coupées.
- Connecté à PFlow Bots (https://pflow-bot-app.vercel.app) avec le compte administrateur.
- Téléphone personnel de Jules (590690938108) à côté, écran visible, WhatsApp ouvert.
- WhatsApp Manager ouvert dans un 2e onglet (business.facebook.com → WhatsApp Manager → Modèles de messages), pour
  montrer que ce que PFlow Bots fait se voit bien chez Meta.
- Le canal PFlow Démo est **actif** (le bot répond) : ne rien changer.
- Ne filmer **aucun** compte ni numéro de client (ag_pizzaa, Mexico, Cookies An Nou) : rester sur la ligne « Numéro
  PFlow (démos) ». Masquer au montage tout jeton, e-mail ou numéro complet qui apparaîtrait.
- Durée visée : 2 à 3 minutes par vidéo, sans son obligatoire ; ajouter des sous-titres en anglais (texte ci-dessous).

## Vidéo 1 : `whatsapp_business_management`

Ce que l'examinateur doit voir : l'app lit les comptes WhatsApp (WABA) et leurs numéros, abonne et désabonne l'app
aux webhooks d'un compte, et crée des modèles de messages sur ce compte, qui apparaissent ensuite dans WhatsApp Manager.

| # | Écran | Action | Ce que l'examinateur voit | Sous-titre (anglais) |
|---|---|---|---|---|
| 1 | Page de connexion de PFlow Bots | Se connecter | L'outil est réservé à l'équipe PFlow | "PFlow Bots is PFlow's internal tool to run WhatsApp ordering assistants for restaurants." |
| 2 | État → « Canaux (numéros et comptes) » | Montrer la ligne « Numéro PFlow (démos) » | Le numéro de PFlow, son état « actif » | "This is PFlow's own WhatsApp Business number, used for our demo assistant." |
| 3 | État → « Diagnostic des comptes WhatsApp » | Coller l'ID du compte WhatsApp de PFlow, « Lancer le diagnostic » | Le compte (nom, ID), ses numéros (numéro affiché, nom vérifié, qualité), les apps abonnées | "We read the WhatsApp Business Account and its phone numbers (whatsapp_business_management)." |
| 4 | État → « Canaux » → ligne PFlow Démo | « Désabonner » | Confirmation ; le diagnostic relancé montre que l'app n'est plus abonnée | "We can unsubscribe our app from the account's webhooks…" |
| 5 | Même ligne | « Abonner PFlow Bots » aussitôt | L'app de nouveau abonnée (diagnostic relancé) | "…and subscribe it again, so incoming messages reach PFlow Bots." |
| 6 | État → « Modèles WhatsApp de la livraison (par compte) » | « Voir les modèles de chaque compte » | La ligne « PFlow Démo (compte de PFlow) » et l'état des 10 modèles | "We manage message templates on the account." |
| 7 | Même carte | « Créer les N manquants » sur la ligne PFlow Démo, confirmer | « N créé(s) et soumis à Meta », statuts « En attente » | "We create utility templates (delivery updates) and submit them to Meta for review." |
| 8 | Onglet WhatsApp Manager → Modèles de messages | Rafraîchir | Les mêmes modèles `pflow_livraison_…`, catégorie Utilitaire, en cours d'examen | "The templates created by PFlow Bots appear in WhatsApp Manager." |

Points d'attention :
- Étapes 4 et 5 : enchaîner sans attendre (quelques secondes sans abonnement : aucun message perdu, Meta réessaie).
- Étape 7 : si les 10 modèles existent déjà sur le compte de PFlow, la carte n'a rien à créer. Dans ce cas, avant
  de filmer, supprimer **un** modèle `pflow_livraison_…` dans WhatsApp Manager (Meta interdit de recréer le même nom
  pendant 30 jours après suppression : choisir un modèle qui n'a pas encore été approuvé, ou filmer avant d'avoir
  créé les 10). Le plus simple : filmer cette vidéo **avant** de créer les modèles sur le compte de PFlow.

### Vérifier avant de filmer : les modèles passeront-ils sur le compte de PFlow ?

Le canal PFlow Démo a deux identifiants : le WABA `1808772226929443` (il répond « Authorization Error » au jeton de
pflow-bots-serveur : nouveau modèle de comptes de Meta) et le compte de messagerie `4170754433058228`. PFlow Bots
interroge **d'abord le compte de messagerie**, puis le WABA, et ne crée rien sur un compte dont la lecture des modèles
a échoué (testé). La seule inconnue est la réponse de Meta sur `4170754433058228/message_templates` : aucun appel
réel n'a encore été fait (rien dans les journaux).

Contrôle sans risque (lecture seule, ne crée rien) : page État → « Modèles WhatsApp de la livraison » → « Voir les
modèles de chaque compte ».
- La ligne « PFlow Démo (compte de PFlow) » affiche les 10 modèles avec un statut (« Absent », « Approuvé »…) :
  la création passera, par le même compte. On peut filmer.
- Elle affiche « Lecture chez Meta impossible (compte de messagerie 4170… : … ; WABA 1808… : …) » : envoie-moi le
  texte. Piste la plus probable : le jeton de pflow-bots-serveur n'a pas la tâche « Gérer les modèles » sur ce compte
  (Business Manager → Utilisateurs système → pflow-bots-serveur → Actifs → compte WhatsApp → cocher « Gérer les
  modèles de messages »). En principe, pas besoin de régénérer le jeton : l'accès aux comptes est vérifié à chaque appel.

## Vidéo 2 : `whatsapp_business_messaging`

Ce que l'examinateur doit voir : un client écrit au numéro de l'entreprise, le message arrive dans l'app (webhook), et
l'entreprise répond depuis l'app ; la réponse arrive sur le téléphone du client.

| # | Écran | Action | Ce que l'examinateur voit | Sous-titre (anglais) |
|---|---|---|---|---|
| 1 | Téléphone de Jules (client) | Écrire « Bonjour, vous êtes ouverts ce soir ? » au numéro PFlow Démo | Le message part | "A customer writes to the business's WhatsApp number." |
| 2 | Téléphone | Attendre la réponse du bot | Réponse automatique de l'assistant | "The assistant replies automatically (whatsapp_business_messaging)." |
| 3 | PFlow Bots → Boîte de réception | Ouvrir la conversation | Le message du client et la réponse du bot, avec l'heure | "Incoming messages are received through webhooks and shown in the inbox." |
| 4 | Conversation | « Reprendre la main » | Le bot se met en pause pour ce client | "A team member takes over the conversation." |
| 5 | Conversation | Taper « Oui, ouverts jusqu'à 22 h ! », « Envoyer » | Le message envoyé apparaît (statut envoyé, puis lu) | "The team replies from PFlow Bots." |
| 6 | Téléphone | Montrer la réponse reçue | La réponse de l'équipe dans WhatsApp | "The customer receives the reply on WhatsApp." |
| 7 | Conversation | « Rendre au bot » | L'assistant reprend | "The conversation is handed back to the assistant." |

Points d'attention : écrire depuis le numéro de Jules seulement ; ne montrer aucune autre conversation (filtrer ou
faire défiler hors champ).

## Textes à coller chez Meta (anglais)

### whatsapp_business_management — description d'usage

PFlow is a technology provider for restaurants in Guadeloupe. Our app, PFlow Bots, runs WhatsApp ordering
assistants on behalf of restaurants. We use whatsapp_business_management to: read the WhatsApp Business Account and
its phone numbers (display number, verified name, quality) to show their status in our dashboard; subscribe our app
to the account's webhooks (and unsubscribe it when a restaurant stops the service) so incoming messages reach our
assistant; and create and list utility message templates (order and delivery updates) on the account, so a
restaurant can notify its customers outside the 24-hour window. The screencast shows each of these actions on our
own WhatsApp Business Account and the result in WhatsApp Manager. Once approved, restaurants will connect their own
accounts through Embedded Signup; we never access an account they have not shared with us.

### whatsapp_business_messaging — description d'usage

We use whatsapp_business_messaging to receive the messages that customers send to a restaurant's WhatsApp number
and to reply to them: our assistant answers questions and helps customers place orders, and the restaurant's team
can take over the conversation and reply from the PFlow Bots inbox. We also mark messages as read and download voice
notes sent by customers so the team can understand them. The screencast shows a customer message arriving in our
inbox, an automatic reply, then a reply written by a team member and received on the customer's phone. Messages are
only sent in reply to a customer, or with approved utility templates for order updates.

### Instructions pour l'examen (reviewer instructions)

PFlow Bots is an internal dashboard used only by the PFlow team; restaurants and their customers interact with it
through WhatsApp. The screencasts attached to each permission show the complete flow on our own WhatsApp Business
Account (PFlow demo number), because Embedded Signup cannot be used to onboard other businesses until this review
is approved.

To test the messaging flow yourself: send any message (for example "Hello, are you open tonight?") to our demo
number +590 690 XX XX XX on WhatsApp. Our assistant replies within a few seconds. The reply in the screencast was
then written from the PFlow Bots inbox.

Login to the dashboard (if needed): https://pflow-bot-app.vercel.app — test account: [e-mail] / [password]. This
account only sees the PFlow demo number. Pages to review: "État" (accounts, webhook subscription, message templates)
and "Boîte de réception" (inbox).

> À compléter par Jules : le numéro PFlow Démo complet ; le compte de test de l'examinateur (voir ci-dessous).

## Compte de test pour l'examinateur

Meta demande souvent un accès pour tester. Aujourd'hui, un administrateur de PFlow Bots voit **toutes** les
conversations, y compris celles des restos clients : ne pas donner ton compte. Deux possibilités :
1. Ne pas fournir de compte : indiquer que l'outil est interne, que les vidéos montrent tout, et que l'examinateur
   peut tester l'envoi et la réception en écrivant au numéro de démo (c'est le cas d'usage visible par le public).
   C'est ce que propose le texte ci-dessus, sans la ligne « Login ».
2. Un compte examinateur limité au numéro PFlow Démo : à construire (rôle « lecture démo »), une PR à part si Meta
   le réclame.

Sources : Meta, « Onboarding business customers as a Tech Provider » (accès avancé requis avant d'intégrer des
clients) : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider ;
Meta, « Multi-Partner Solutions » (message « cannot be used for onboarding at this time » pour une solution
inactive) : https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions/
