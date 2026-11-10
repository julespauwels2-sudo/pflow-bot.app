# Plan PFlow Bots : étapes et points notés pour plus tard

Ordre validé par Jules. Rien ne passe à l'étape suivante sans sa validation.

## Phase 1

| Étape | Contenu | État |
|---|---|---|
| A1–A4 | Socle, moteur, stockage local, éditeur tableau blanc | Fait |
| Compléments A4 | Flux par défaut, bloc Délai, mode de déclenchement par client | Fait |
| M1 | Bloc Message façon UChat (bulles, bouton de réponse / bouton lien) | Fait |
| M2 | Variables de la fiche d'infos (horaires, livraison, planning…) | Fait |
| M3 | Dossiers, modèle maître, événements de commande, bots liés, options payantes | Fait |
| A5 | Simulateur : tester le bot en direct dans un chat | Fait |
| A6 | Agent IA par client (consigne), base de connaissances, réglages du modèle, journal et coût ; fonctions `lancer_commande`, `proposer_commande`, `parler_equipe` | Fait |
| B | Supabase (tables `bot_` uniquement, SQL montré avant), auth, lecture seule du CRM | Fait |
| C | WhatsApp : connexion, webhook, coexistence, boîte de réception, tests sur le numéro de test Meta | Code prêt sans Meta (webhook, envoi, échos, boîte de réception), testé contre un faux Meta ; reste C0 (Meta) et la migration C — voir [`docs/etape-c/`](etape-c/README.md) et [`docs/journal.md`](journal.md) |

## Où on en est (10 novembre 2026)

### Fait (en production)
- **Charte PFlow** sur toutes les pages (PR n° 20) ; règle pour toute nouvelle page (plus bas).
- **Embedded Signup v4 en coexistence** (PR n° 17) : code et tables `bot_connexions_whatsapp`, `bot_jetons_whatsapp`
  en place ; variables `META_APP_ID`, `META_ES_CONFIG_ID` dans Vercel ; champs du webhook abonnés. **Bloqué chez
  Meta** tant que l'examen de l'app et le statut Tech Provider ne sont pas validés (pas notre configuration).
- **Jeton Meta de 60 jours** (PR n° 21) : échéance gardée, renouvellement quotidien, alerte et lien de reconnexion ;
  migration `bot_jetons_expiration` appliquée.
- **Examen Meta sans Embedded Signup** (PR n° 22) : scénarios des 2 vidéos et textes en anglais
  (`docs/etape-c/examen-meta-videos.md`) ; PFlow Démo dans la carte des modèles.
- **CRM : qg77 et qg150 joués le 10 novembre** : secret de send-push dans Vault, plus aucun secret en clair ;
  rappels au resto à 5, 10 et 15 min pour une commande pas acceptée, « C'est l'heure » pour une commande
  programmée (PR CRM n° 85 et n° 101).
- **« ⭐ Me conseiller » avec des boutons** (PR n° 27, option activée dans le modèle maître) : choix de la carte
  (boutons ou liste), puis 2 ou 3 produits avec les prix, « Commander » et « Autre chose ». Listes personnalisées
  enregistrées le 10 novembre pour Mexico (Bœuf, Poulet, Végan, Agneau ven-sam-dim) et AG Pizza (Viande, Fromage,
  Veggie & poisson) ; Cookies : familles automatiques (Cookies, Box). Doc : `docs/etape-c/me-conseiller-boutons.md`.
- **3 canaux en test** (Cookies An Nou, Mexico, ag_pizzaa), sans effet sur le trafic actuel ; alertes push du QG
  (10 types).

### PR ouvertes (nuit du 10 novembre, à valider)
- PR n° 23 : compte examinateur Meta (boîte de réception limitée à PFlow Démo) ; SQL `bot_examinateurs` à valider.
- PR n° 24 : modèles de la livraison, erreur de chaque identifiant ; contrôle avant la vidéo.
- PR n° 25 : bouton « Livraison » pour un resto en retrait seulement.
- PR de documentation : préparation de la migration (`docs/etape-c/preparation-migration-19-21.md`) et ce point.
- PR CRM : test `sons-tendance` réparé (date figée), sans toucher au code.

### Avant le 19 novembre
- Examen Meta : compte examinateur (PR n° 23 + SQL + création du compte), contrôle « Voir les modèles » sur le
  compte de PFlow, les 2 vidéos, soumission des 2 autorisations avec les textes en anglais.
- Fiches des 3 restos (`docs/etape-c/preparation-migration-19-21.md`) : adresses de Mexico et d'ag pizza ; points
  de vente et moyens de paiement de Cookies ; FAQ et règles proposées à valider.
- Décisions : Cookies en zones ou en tournées ; paiement en ligne de Cookies (SumUp / Stripe ou rien) ; nom affiché
  « AG Pizza » dans le CRM.
- ag pizza : « Revenir au modèle » pour la copie de l'Accueil (ou le 19).
- Runbook `migration-3-clients.md`, partie 1 (vérifications des numéros).
- Rappels de commande : vérifier à la prochaine vraie commande restée en attente.
- Mexico : description du Burrito Végan et du Bowl Végan à corriger dans le CRM (Jules : « agneau effiloché », et
  « crème, fromage râpé » qui ne sont pas végan non plus) ; ensuite vérifier que la carte lue par le bot ne
  contient plus « agneau » pour ces plats.

### Migration du 19 au 21 novembre
- 19 : prérequis communs, puis **Cookies** (mode « toujours ») : 5 étapes du runbook.
- 20 : **Mexico** et **ag pizza** (mots-clés uniquement).
- 21 : clôture d'UChat (bots désactivés, contrôle des numéros).

### Après le 22 novembre
- UChat résilié avant le renouvellement du 22 ; puis retrait de Smart Link et renouvellement de `PONT_CLE`.
- Embedded Signup pour les nouveaux restos, dès la validation de Meta (examen + Tech Provider) ; au premier resto
  connecté : vérifier l'étape « jeton_droits » et « Renouveler maintenant ».
- Supprimer le compte examinateur après l'examen.
- **Lien direct vers un produit** (décision de Jules, 10 novembre 2026 : après la migration du 19 au 21) : PR CRM
  séparée pour que la page de commande ouvre un produit précis (paramètre dans l'adresse), puis le bouton
  « 🛒 Commander » de « Me conseiller » pointe vers le produit recommandé. Aujourd'hui il ouvre la page du resto.
- Livraison : route `pflow-livraison` (contrat `ad59937`) et modèles de la livraison sur chaque compte.
- Centre d'alertes unique ; Instagram (après validation de Meta) ; buckets publics du CRM avant le prochain
  questionnaire d'onboarding.

## Points notés pour plus tard

### Sécurité du CRM (décisions de Jules, novembre 2026)
- **`PONT_CLE` : à renouveler après l'arrêt d'UChat** (quand plus aucun bot UChat n'a le Bot Field
  `pflow_cle`). Jamais fuité : pas de changement avant. Restent alors Vercel et le secret GitHub du
  rendu des vidéos (procédure : `docs/securite-crm.md`, point 2). Le patch 06 ne sera plus utile.
- Buckets publics listables (point 1 de `docs/securite-crm.md`) : à corriger **avant le prochain
  questionnaire d'onboarding envoyé à un client**.

### Numérotation des scripts SQL du CRM (règle de Jules, 8 novembre 2026)
- Livraison : **qg88 à qg149**. PFlow Bots et le reste du CRM : **à partir de qg150**.
- Avant de créer un script : vérifier `main` de Pflow-Crm, `repo/sql/NUMEROTATION.md` et les branches ouvertes ;
  ajouter la ligne du script dans ce fichier, dans la même PR (PR n° 78 de Pflow-Crm pour le fichier).

### Charte graphique de PFlow Bots (décision de Jules, 9 novembre 2026)
- **La charte PFlow est la référence pour toute nouvelle page de PFlow Bots** (PR n° 20, validée par Jules) :
  - fonds en **aplat** nuit `#0A1236`, bleu `#2AABFF`, rose `#FF4FB5` ; aucun dégradé, halo ni flou ;
  - titres en **Anton majuscules** (un seul segment en rose), texte en **Plus Jakarta Sans** ;
  - **cartes blanches** à texte nuit sur le fond nuit, ombres plates `rgba(0,0,0,.28)` ;
  - boutons en **pill rose** à texte nuit ; badges en aplat (reflet, rose, bleu) ;
  - petit texte d'accent sur blanc : **`#C8157F`** (rose foncé) et **`#0067B8`** (bleu foncé), jamais le rose vif.
- Une nouvelle page n'utilise que les jetons et composants existants (`src/app/globals.css`, `src/components/ui.tsx`) :
  aucune couleur, police ou ombre écrite en dur. Détail : `docs/etape-c/direction-artistique.md`.

### Sortie d'UChat (décision de Jules, 8 novembre 2026)
- Bascule numéro par numéro : **pause du bot UChat** pour le contact de test pendant les essais, puis
  **désactivation du bot UChat** du numéro à la bascule. Le partenaire **Smart Link** (prestataire d'UChat,
  accès total aux comptes) **reste en place** pendant toutes les bascules (retour arrière possible).
- **Retrait de Smart Link = toute dernière étape**, seulement **après l'arrêt complet d'UChat** (plus aucun
  numéro ni bot sur UChat), et après avoir vérifié qu'aucun compte de messagerie n'est payé par sa ligne de
  crédit. Puis renouveler `PONT_CLE` (ci-dessus).
- **Calendrier** (9 novembre 2026) : bascule des 3 clients (Cookies An Nou, Mexico, ag_pizzaa) du **19 au 21
  novembre**, résiliation d'UChat avant le renouvellement du **22 novembre**. Runbook :
  `docs/etape-c/migration-3-clients.md`.
- **Instagram retiré des prérequis de l'arrêt d'UChat** (décision de Jules, 9 novembre 2026) : aucun client ne
  l'utilise. Il attend la validation de Meta et se fera plus tard, sans lien avec la sortie d'UChat.
- **Embedded Signup v4 + statut Tech Provider : après le 22 novembre** (décision de Jules, 9 novembre 2026).
  Seul moyen de mettre le numéro d'un nouveau resto sur l'API en lui laissant son appli (coexistence). Démarches
  Meta (vérification de l'entreprise, examen de l'app, Tech Provider) puis ≈ 4 à 5 jours de développement.
  État des lieux : `docs/etape-c/nouveau-client.md`.

### Démos sur le numéro PFlow (fait, actif après la migration C)
- Le futur webhook PFlow Order (événements de commande) ne doit **jamais** viser le numéro PFlow ni une
  démo : les commandes de démo passent par la page de démonstration du CRM, qui n'écrit rien.
- Suppression des démos expirées : aujourd'hui au chargement de l'app ; à passer en tâche planifiée
  (Vercel Cron) avec l'étape C.

- ✅ **PFlow Démo (+590 691 26 68 53) est ACTIF depuis le 9 novembre 2026** (bot UChat de ce numéro désactivé,
  Smart Link gardé). Testé de bout en bout par un vrai testeur : commande, confirmation automatique, dashboard,
  étape 3, « Je veux le mien », notification push reçue par Jules. Historique de la démo permanente :
  `docs/etape-c/demo-permanente.md` et `docs/journal.md`. Suites : étape 3 en ≈ 20 s, vrais boutons dans la boîte
  de réception, diagnostic des comptes WhatsApp (PR du 9 novembre).
- **Réponses intelligentes** (PR du 9 novembre, nuit) : politesse sans alerte, questions répondues par l'IA à partir
  d'une base modifiable sans code (page Démos), alerte à Jules seulement si l'IA ne sait pas, inscription, prix,
  livraison ou demande de Jules. Détail : `docs/etape-c/demo-reponses.md`.
- **Test réel encore à faire** : boutons « Retour sur WhatsApp » (wa.me + texte prérempli) depuis le navigateur
  intégré de WhatsApp, sur Android (secours codé : rappel de l'étape avec [✅ C'est fait]).

- ✅ **Direction artistique** (PR du 9 novembre) : thème centralisé (`src/app/globals.css`), écrans iPhone, icône et
  écran de lancement « PFlow Bots ». Détail : `docs/etape-c/direction-artistique.md`.
- ✅ **Charte PFlow sur toutes les pages** (PR n° 20) : aplats, Anton et Plus Jakarta Sans, cartes blanches, pills
  roses. Référence pour toute nouvelle page (voir « Charte graphique de PFlow Bots » plus haut).

### Étape B
- **Options payantes** (ex. relance panier abandonné) : lues dans le CRM (modules du resto). **Les
  seules options payantes côté bot sont celles du CRM.** Le **paiement en ligne n'en est pas une** : il
  fait partie de l'offre de base (SumUp, Stripe, peut-être d'autres plus tard). Le bot se base
  uniquement sur le mode réellement en vigueur (`paiement_mode_public` : choix / obligatoire / non),
  jamais sur la notion d'option vendue, et ne nomme jamais le prestataire (« en ligne par carte »).
  Sans prestataire prêt : point d'onboarding « Paiement en ligne pas encore configuré (SumUp ou
  Stripe) » dans la liste de contrôle (décision de Jules, novembre 2026).
- Fiche d'infos lue **directement** dans le CRM (atelier) et le dashboard PFlow Order : horaires, carte…
  Les champs propres au bot (consigne IA, FAQ) restent dans les tables `bot_`. Regarder le CRM en
  lecture seule et proposer comment faire.
- **Jours de livraison fixes par zone** (champ générique de la fiche du bot, ex. Jarry : mardi, mercredi,
  vendredi ; table `bot_fiches`) : à passer plus tard dans le CRM avec les points de vente et le planning,
  puis à lire comme les horaires (grisé « CRM »). Les tournées datées à venir s'y ajoutent comme
  livraisons exceptionnelles.
- **Planning de livraison et points de vente** : absents du CRM aujourd'hui (vérifié en lecture seule le
  5 novembre 2026 : ni table, ni colonne, ni champ JSON). En attendant, ils se saisissent dans la fiche du bot
  (`bot_tournees`, `bot_fiches`). **Plus tard** : les ajouter dans le CRM / le dashboard de la gérante (qui
  pourra mettre ses tournées à jour elle-même), puis les brancher comme les horaires : lus dans le CRM,
  grisés « CRM » dans la fiche du bot. Modification du CRM à montrer à Jules avant de la faire.
- Livraison : des tournées à venir font passer le resto « sur planning » automatiquement ; un titre suivi
  d'une variable vide (ex. « 🏪 Points de vente ») n'est pas envoyé.
- ~~Création automatique du bot~~ **Fait le 5 novembre 2026** : restos signés, actifs ou en démo, à
  l'ouverture de l'app, écriture dans `bot_clients` uniquement (voir `docs/journal.md`).
- Option 3 du lien de commande (étapes B/C) : pré-remplissage du téléphone et du prénom + rattachement
  des commandes au bot pour les stats. **Montrer la modification prévue dans PFlow Order avant de la faire.**

### Étape C
- Branchement des événements de commande : PFlow Order prévient le bot (paiement validé, statuts,
  panier abandonné). **Pas de templates** : si la fenêtre de 24 h est fermée, le bot n'envoie rien.
  Montrer la modification de PFlow Order avant de la faire. Flux préparés dans le modèle maître en M3.
  - Les événements de commande sont envoyés **même si le contact est en pause** (transfert humain,
    gérant qui a répondu), toujours soumis aux 24 h, et sans relancer la conversation du bot.
- **Modifications à prévoir dans PFlow Order** (à montrer à Jules avant de les faire) :
  - prévenir le bot à chaque événement de commande (validée, en préparation, prête) ;
  - envoyer l'événement **« panier abandonné » après 20 minutes** sans validation (c'est PFlow Order
    qui connaît l'état du panier : pas de tâche planifiée côté bot) ;
  - bouton « Retour sur WhatsApp » sur la page de confirmation ;
  - option 3 du lien de commande : pré-remplissage téléphone / prénom et rattachement des commandes au bot ;
  - API pour les fonctions IA `annuler_commande` et `suivre_commande`, et pour marquer un panier
    « laissé tomber ».
- Bouton « Retour sur WhatsApp » (`wa.me`) sur la page de confirmation de PFlow Order.
- Transfert humain : alerte dans la boîte de réception + **notification push** (seule voie depuis le 9 novembre
  2026 : ni WhatsApp vers le gérant, ni modèle Meta, ni e-mail ; `docs/etape-c/alertes-jules.md`).
- ~~Décision Vercel~~ : Vercel Pro pris le 8 novembre 2026 (équipe « Pflow » : CRM, site, PFlow Bots).

### Avant la bascule de chaque resto (noté le 7 novembre 2026)
- **ag_pizzaa** : son bot a **sa propre copie de l'Accueil** (personnalisation), qui ne reçoit plus les
  mises à jour du modèle maître : mots-clés encore « bonjour, salut, hello, menu, **commander** » (le
  modèle a déplacé « commander » vers « CTA - Commander »), pas de version courte de l'accueil (12 h),
  prénom tiré du premier mot du profil. **Avant sa bascule** : soit supprimer sa copie pour le relier au
  modèle (page du client → flux Accueil → « Revenir au modèle »), soit reporter ces changements à la main.
  Son bot est aujourd'hui en mode « mots-clés uniquement ».
- Événements de commande pas encore couverts : aucun (annulée, remboursée, annulation refusée et rappel
  ajoutés le 7 novembre). Suivi et annulation par l'IA : `PFLOW_ORDER_PONT_CLE` dans Vercel (C5).

### Plus tard (décidé par Jules le 5 novembre 2026)
- **Boîte de réception pour les gérants** : chaque gérant voit seulement les conversations de son resto
  (compte du dashboard, droit limité à son resto). Pas maintenant.
- ~~Hébergement~~ : Vercel Pro (8 novembre 2026).
- **CRM : test `repo/tests/sons-tendance.test.js` en échec sur `main`** (noté le 8 novembre 2026, à traiter plus
  tard, PR séparée). Sous-test « un réel avec son tendance ne part jamais par l'API : notification avec le son,
  relance, « C'est posté » » ; les 3 autres passent. Sans rapport avec la démo permanente (même échec sur `main`).
  Lancer : `cd repo && node --test tests/sons-tendance.test.js`.
- **Centre d'alertes unique dans PFlow Bots** (audit du 9 novembre 2026, `docs/etape-c/audit-notifications-crm.md`) :
  PFlow Bots lit la table `alertes` du CRM (lecture seule) et pousse les alertes critiques ; le QG garde le personnel.
  ≈ 1 jour, après Embedded Signup. **Urgent avant** : ajouter `COMMANDE_EN_ATTENTE` (et paiements, silence) au push du
  QG (1 ligne SQL, à jouer par Jules).
- **Embedded Signup v4 avec coexistence** (PR du 9 novembre, chantier C) : construit et testé (faux Meta). À faire par
  Jules : SQL `20261111000000_bot_connexions_whatsapp`, variables `BOT_JETONS_CLE`, `META_APP_ID`, `META_ES_CONFIG_ID`,
  démarches Meta dans l'ordre (vérification d'entreprise, configuration v4, Tech Provider, App Review avec 2 vidéos).
  Détail : `docs/etape-c/embedded-signup.md`.
- **Livraison : route `POST /api/webhooks/pflow-livraison`** (contrat `docs/livraison/INTERFACE-PFLOW-BOTS.md` du
  CRM, version du commit ad59937, décision finale de Jules). Les messages de suivi partent **toujours du numéro du
  resto**, **jamais** du numéro PFlow (aucun secours) : texte libre avec bouton « Suivre ma livraison » si la fenêtre
  de 24 h est ouverte, modèle sinon ; sinon `pas_de_canal` / `modele_absent` / `erreur_meta`, et PFlow Order réessaie
  puis alerte Jules. À construire : même signature que `/api/webhooks/pflow-order` ; envoi de **modèles** (absent du
  client Graph aujourd'hui) ; idempotence gardée 24 h **avant** l'appel à Meta (nouvelle table `bot_`, SQL à montrer) ;
  code de livraison jamais dans les journaux ; réponse en moins de 8 s. ≈ 1 jour. Prérequis : canaux **actifs** des
  restos (bascule 19-21 et Embedded Signup) et les **10 modèles** `pflow_livraison_*` approuvés sur le compte WhatsApp
  de chaque resto (création par l'API de Meta, intégrée à Embedded Signup). Le §5 a été corrigé (commit ad59937). Pour un resto connecté par l'Embedded Signup, le modèle se
  cherche sur le compte WhatsApp du resto (le sien), pas sur celui de Jules.
- **Supervision du CRM et arrêt d'UChat** : les sondes interrogent encore UChat (fausses pannes après l'arrêt). À
  adapter avec la bascule (PR CRM).
- ~~**Notifications push pour le CRM**~~ : le CRM en a déjà (app QG). Ancienne note : (noté le 9 novembre 2026, chantier séparé) : même principe que la boîte de
  réception de PFlow Bots (app installée, Web Push, clés VAPID), pour les alertes du CRM. Pas maintenant.

### Phase 2
- ~~Fonctions IA `annuler_commande` et `suivre_commande`~~ : faites le 7 novembre 2026 (C5, pont existant
  de PFlow Order, annulation toujours confirmée par le client).
- Messages vocaux : transcription (service payant à proposer, exception à la règle « coût quasi nul »).
- Instagram, Embedded Signup, messages différés et relances, statistiques, migration des clients UChat.
- Fonctions IA génériques et serveurs MCP.

Référence du template UChat de Jules : `docs/reference/template-uchat.md`.
