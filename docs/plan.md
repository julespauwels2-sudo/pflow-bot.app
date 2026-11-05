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

## Points notés pour plus tard

### Démos sur le numéro PFlow (fait, actif après la migration C)
- Le futur webhook PFlow Order (événements de commande) ne doit **jamais** viser le numéro PFlow ni une
  démo : les commandes de démo passent par la page de démonstration du CRM, qui n'écrit rien.
- Suppression des démos expirées : aujourd'hui au chargement de l'app ; à passer en tâche planifiée
  (Vercel Cron) avec l'étape C.

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
- Transfert humain : alerte dans la boîte de réception + WhatsApp au gérant si sa fenêtre de 24 h est
  ouverte. Notification par e-mail (présente dans le template UChat) : proposer une solution gratuite.
- Décision Vercel (plan Hobby non commercial) et webhook isolé pour pouvoir l'héberger ailleurs.

### Plus tard (décidé par Jules le 5 novembre 2026)
- **Boîte de réception pour les gérants** : chaque gérant voit seulement les conversations de son resto
  (compte du dashboard, droit limité à son resto). Pas maintenant.
- **Hébergement** : Vercel gratuit pendant les tests sur le numéro de test Meta ; décision (Vercel Pro ou
  Supabase Edge Functions) avant la bascule du premier client.

### Phase 2
- Fonctions IA `annuler_commande` et `suivre_commande` (API PFlow Order), avec accord de Jules sur ce
  que l'app peut modifier.
- Messages vocaux : transcription (service payant à proposer, exception à la règle « coût quasi nul »).
- Instagram, Embedded Signup, messages différés et relances, statistiques, migration des clients UChat.
- Fonctions IA génériques et serveurs MCP.

Référence du template UChat de Jules : `docs/reference/template-uchat.md`.
