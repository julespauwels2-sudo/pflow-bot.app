# Guide pas à pas — app Meta, numéro de test, utilisateur système, token (WhatsApp puis Instagram)

À faire par Jules au début de l'étape C (sous-étape C0). Compter 30 à 45 minutes.

> **À vérifier le jour J.** Écrit le 5 novembre 2026 sans accès à la documentation de Meta depuis la
> session : les noms des menus de Meta changent souvent. Si un intitulé ne correspond pas, chercher
> l'équivalent ; les principes (app, utilisateur système, token permanent, webhook) ne changent pas.
> Les points marqués ⚠️ sont à revérifier dans la documentation officielle :
> <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>.

**Règle de sécurité.** Le token, la clé secrète de l'app et la phrase de vérification ne se collent
**jamais** dans une conversation, un e-mail ou Git : uniquement dans les variables d'environnement de
Vercel. Seuls les identifiants (Phone number ID, WABA ID) peuvent m'être donnés : ils ne sont pas secrets.

## 0. Avant de commencer

- Un compte Facebook personnel avec la **double authentification activée** (obligatoire pour gérer une
  entreprise en sécurité).
- Un **portefeuille d'entreprise** (Business Manager) « PFlow » sur <https://business.facebook.com>.
  S'il n'existe pas : le créer avec le nom de la micro-entreprise et l'e-mail pro.
- ⚠️ La **vérification de l'entreprise** (Kbis ou avis de situation SIRENE, site pflow.fr) n'est pas
  nécessaire pour le numéro de test, mais le sera pour les vrais numéros (limites d'envoi, nom affiché).
  La lancer dès maintenant fait gagner du temps : elle peut prendre plusieurs jours.
- La page de politique de confidentialité de PFlow en ligne (exigée pour passer l'app en mode « Live »).

## 1. Créer l'app

1. Aller sur <https://developers.facebook.com> → **Mes apps** → **Créer une app**.
2. Cas d'usage : **« Communiquer avec les clients via WhatsApp »** (ou, selon l'écran : « Autre » puis
   type **Entreprise**).
3. Nom de l'app : **PFlow Bots**. E-mail de contact : l'e-mail pro.
4. Portefeuille d'entreprise : **PFlow**.
5. Valider. Meta crée en même temps un **compte WhatsApp Business (WABA) de test** et un **numéro de test**.

## 2. Numéro de test et premier message

1. Dans l'app : **WhatsApp** → **Configuration de l'API** (« API Setup »).
2. Noter (pas secrets) :
   - **Phone number ID** (identifiant du numéro de test) ;
   - **WhatsApp Business Account ID** (WABA ID).
3. Section **« À »** (destinataires) : ajouter **ton numéro WhatsApp** (format +590…). Meta envoie un code
   sur WhatsApp pour le confirmer. ⚠️ Le numéro de test n'écrit qu'à 5 numéros confirmés au maximum.
4. Cliquer sur **« Envoyer un message »** : tu reçois le modèle « hello_world ». Le compte fonctionne.
5. **Réponds « Bonjour » à ce message** depuis ton téléphone : ça ouvre la fenêtre de 24 h (indispensable
   pour les tests du bot, qui n'envoie que des messages de service).

Le token affiché sur cette page est **temporaire (24 h)** : ne pas l'utiliser, on crée un token permanent
à l'étape 4.

## 3. Clé secrète de l'app

1. Dans l'app : **Paramètres de l'app** → **Général** (« Basic »).
2. **Clé secrète** (« App secret ») → **Afficher** (mot de passe Facebook demandé).
3. La coller dans Vercel (projet PFlow Bots) : variable `WHATSAPP_APP_SECRET`. Elle sert à vérifier que
   chaque message reçu vient bien de Meta.
4. Sur la même page : renseigner l'**URL de la politique de confidentialité** et la catégorie.

## 4. Utilisateur système et token permanent

L'utilisateur système est un « robot » du portefeuille d'entreprise : son token ne dépend pas de ton
compte Facebook et n'expire pas.

1. <https://business.facebook.com> → **Paramètres** (de l'entreprise) → **Utilisateurs** →
   **Utilisateurs système** → **Ajouter**.
2. Nom : **pflow-bots**. Rôle : **Admin**. ⚠️ (Un rôle « Employé » suffit si les actifs ci-dessous lui
   sont attribués en contrôle total ; Admin est plus simple pour gérer plusieurs restos.)
3. **Attribuer des actifs** (« Assign assets ») :
   - **Apps** → PFlow Bots → **Contrôle total** (gérer l'app) ;
   - **Comptes WhatsApp** → le compte WhatsApp (celui du numéro de test, puis ceux des restos plus tard) →
     **Contrôle total**.
4. **Générer un nouveau token** :
   - App : **PFlow Bots** ;
   - Expiration : **Jamais** ;
   - Autorisations : **`whatsapp_business_messaging`** et **`whatsapp_business_management`**
     (⚠️ `business_management` seulement si l'écran le demande).
5. Copier le token **une seule fois**, directement dans Vercel : variable `WHATSAPP_TOKEN`. Meta ne le
   réaffiche plus. Ne pas le garder dans un fichier.
6. En cas de doute (token copié au mauvais endroit) : même écran → **Révoquer** les tokens, puis en
   générer un nouveau et remplacer la variable dans Vercel.

## 5. Phrase de vérification du webhook

Choisir une phrase longue et aléatoire (ex. générée par le gestionnaire de mots de passe). La mettre dans
Vercel : variable `WHATSAPP_VERIFY_TOKEN`. Elle sert une seule fois, quand Meta vérifie l'adresse du webhook.

## 6. Brancher le webhook (seulement quand C1 est déployé)

Je te préviendrai : il faut que l'adresse réponde avant de la donner à Meta.

1. Dans l'app : **WhatsApp** → **Configuration** → **Webhook** → **Modifier**.
2. **URL de rappel** : `https://<adresse de PFlow Bots>/api/webhooks/whatsapp`.
3. **Jeton de vérification** : la phrase de l'étape 5. Valider : Meta appelle l'adresse, qui répond.
4. **Champs du webhook** → s'abonner à **`messages`**. (En C6, pour la coexistence : ⚠️ `smb_message_echoes`
   et les champs d'historique proposés par Meta.)
5. ⚠️ Relier l'app au compte WhatsApp (« subscribed_apps ») : souvent fait automatiquement par l'écran
   ci-dessus ; sinon je te donnerai la commande exacte à lancer (elle utilise le token, donc tu la lances
   toi-même).

### Dépannage : le message arrive sur WhatsApp mais le bot ne répond pas

- Le bouton **« Tester »** à côté d'un champ envoie un **faux** message (identifiant `ABGGFlA5Fpa`, numéro
  fictif) : il prouve seulement que l'adresse répond. Dans les journaux Vercel, il apparaît comme
  « exemple du bouton « Tester » de Meta ». Un vrai message apparaît comme « reçu : 1 message(s) ».
- Aucune ligne `[whatsapp] reçu` dans les journaux après un vrai message = Meta n'envoie rien. Vérifier :
  1. **Champs du webhook** : la ligne `messages` est bien **abonnée** (interrupteur activé, pas seulement testée).
  2. **Lien app ↔ compte WhatsApp** : outil **Graph API Explorer** (developers.facebook.com/tools/explorer),
     app **PFlow Bots**, `GET <WABA ID>/subscribed_apps`. Si la liste est vide : `POST <WABA ID>/subscribed_apps`,
     puis refaire le `GET` (PFlow Bots doit apparaître).
- « reçu : 1 message(s) ; ignorés : canal en test : numéro hors liste » = le numéro qui écrit n'est pas dans
  `test_numeros` du canal.
- « erreurs : 1 » avec « Envoi à … » = réponse calculée mais refusée par l'API Graph (le détail de l'erreur
  Meta suit sur la ligne d'erreur).

## 7. Passer l'app en mode « Live » (avant les vrais numéros, C6)

1. Vérifier : politique de confidentialité, icône, catégorie, e-mail de contact.
2. Basculer **Mode : Développement → Live** en haut de l'app.
3. ⚠️ Pour gérer **les numéros de ton propre portefeuille**, l'accès standard aux autorisations WhatsApp
   suffit en général (pas d'examen de l'app). Un examen serait nécessaire pour gérer les comptes d'autres
   entreprises (onboarding des restos eux-mêmes, prévu plus tard).

## 8. Ajouter un vrai numéro (C6, pas avant)

- Numéro dédié : WhatsApp Manager → **Numéros de téléphone** → **Ajouter**, nom affiché (validé par
  Meta), code par SMS ou appel, puis enregistrement avec un code PIN à 6 chiffres (je te guiderai).
- Numéro du gérant en **coexistence** (il garde son appli WhatsApp Business) : ⚠️ parcours d'inscription
  particulier proposé par Meta (QR code scanné depuis l'appli WhatsApp Business), conditions et pays à
  vérifier au moment de C6. On le fera d'abord avec ton propre numéro.

## Ce que je te demanderai à la fin de C0

| Donnée | Où la mettre |
|---|---|
| Phone number ID du numéro de test | Me la donner (pas secrète) |
| WABA ID | Me la donner (pas secrète) |
| Ton numéro de test confirmé | Me le donner |
| `WHATSAPP_TOKEN` | Vercel uniquement |
| `WHATSAPP_APP_SECRET` | Vercel uniquement |
| `WHATSAPP_VERIFY_TOKEN` | Vercel uniquement |

---

## 9. Instagram (après WhatsApp, quand tu le décides)

Le code est prêt (`/api/webhooks/instagram`, testé contre un faux serveur) et **inactif** tant que les
variables `INSTAGRAM_*` ne sont pas définies. ⚠️ Tout ce qui suit est à revérifier dans la documentation
de Meta au moment du branchement (les noms de permissions et d'écrans changent souvent).

### 9.1 Ce qu'il faut côté Instagram
- Un compte Instagram **professionnel** (Entreprise ou Créateur) : le tien d'abord pour les tests.
- Dans l'appli Instagram : **Paramètres → Messages et réponses aux stories → Contrôles des messages →
  Outils connectés → Autoriser l'accès aux messages** (sans ça, Meta n'envoie rien au webhook).

### 9.2 Dans l'app Meta (la même que pour WhatsApp)
1. **Ajouter un produit → Instagram**, puis choisir **« API Instagram avec connexion Instagram »**
   (adresse `graph.instagram.com`, pas besoin de page Facebook). C'est l'option prévue par le code
   (`INSTAGRAM_GRAPH_BASE` par défaut = `https://graph.instagram.com`).
2. **Permissions** demandées : `instagram_business_basic` et `instagram_business_manage_messages`.
3. **Générer un token** pour ton compte Instagram (écran « Générer des tokens d'accès ») →
   `INSTAGRAM_TOKEN` (Vercel uniquement). ⚠️ Ce token dure 60 jours et doit être prolongé : on prévoira
   un rappel ou un renouvellement automatique avant le premier client.
4. Noter l'**identifiant du compte Instagram professionnel** (pas secret) : c'est le `compte_id` du canal.
5. **Clé secrète de l'app Instagram** (Paramètres de l'API Instagram → « Clé secrète de l'app Instagram »,
   elle peut différer de celle de l'app Meta) → `INSTAGRAM_APP_SECRET`.
6. Inventer une phrase → `INSTAGRAM_VERIFY_TOKEN`.
7. **Webhooks** : URL `https://<ton-app>.vercel.app/api/webhooks/instagram`, même phrase, puis abonner les
   champs `messages`, `messaging_postbacks` et `messaging_seen` (les autres — réactions, référents —
   ne servent pas pour l'instant).

### 9.3 Validation de l'app (App Review) — nécessaire pour les clients
- **Accès standard** (sans validation) : le bot ne fonctionne qu'avec les comptes qui ont un rôle dans
  l'app (toi, comptes de test). Suffisant pour tous nos tests.
- **Accès avancé** de `instagram_business_manage_messages` : obligatoire pour les comptes des restos.
  Il faut : la **vérification d'entreprise** (Business Verification, documents de PFlow), une **politique
  de confidentialité** publique, une **vidéo de démonstration** (connexion du compte, réception d'un
  message, réponse du bot), et l'app en mode **Live**. Compter plusieurs jours, parfois des refus à
  corriger.
- Même règle de **24 h** que WhatsApp : le bot ne peut répondre que dans les 24 h qui suivent le dernier
  message du client (pas de modèles payants comme sur WhatsApp).

### 9.4 Ce que je te demanderai pour Instagram

| Donnée | Où la mettre |
|---|---|
| Identifiant du compte Instagram professionnel | Me la donner (pas secrète) |
| `INSTAGRAM_TOKEN` | Vercel uniquement |
| `INSTAGRAM_APP_SECRET` | Vercel uniquement |
| `INSTAGRAM_VERIFY_TOKEN` | Vercel uniquement |

Sources consultées le 4 novembre 2026 (à relire au moment du branchement) :
[Messaging API (Instagram Login)](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api),
[Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login),
[Instagram Messaging (Messenger Platform)](https://developers.facebook.com/docs/messenger-platform/instagram).
