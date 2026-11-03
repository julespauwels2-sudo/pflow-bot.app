# Plan PFlow Bots : étapes et points notés pour plus tard

Ordre validé par Jules. Rien ne passe à l'étape suivante sans sa validation.

## Phase 1

| Étape | Contenu | État |
|---|---|---|
| A1–A4 | Socle, moteur, stockage local, éditeur tableau blanc | Fait |
| Compléments A4 | Flux par défaut, bloc Délai, mode de déclenchement par client | Fait |
| M1 | Bloc Message façon UChat (bulles, bouton de réponse / bouton lien) | Fait |
| M2 | Variables de la fiche d'infos (horaires, livraison, planning…) | Fait |
| M3 | Modèle maître, bots liés, personnaliser / détacher, « Créer le bot depuis le modèle » | À faire |
| A5 | Simulateur : tester le bot en direct dans un chat | À faire |
| A6 | Agent IA par client (consigne), base de connaissances, réglages du modèle, journal et coût ; fonctions `lancer_commande`, `proposer_commande`, `parler_equipe` | À faire |
| B | Supabase (tables `bot_` uniquement, SQL montré avant), auth, lecture seule du CRM | À faire |
| C | WhatsApp : connexion, webhook, coexistence, boîte de réception, tests sur le numéro de test Meta | À faire |

## Points notés pour plus tard

### Étape B
- Fiche d'infos lue **directement** dans le CRM (atelier) et le dashboard PFlow Order : horaires, carte…
  Les champs propres au bot (consigne IA, FAQ) restent dans les tables `bot_`. Regarder le CRM en
  lecture seule et proposer comment faire.
- **Planning de livraison** : la gérante doit pouvoir mettre ses tournées à jour elle-même depuis son
  dashboard (aujourd'hui : saisi dans la fiche d'infos du bot).
- Création automatique du bot quand un client passe en onboarding dans le CRM (même action que le
  bouton « Créer le bot depuis le modèle »), sans risquer de casser le CRM.
- Option 3 du lien de commande (étapes B/C) : pré-remplissage du téléphone et du prénom + rattachement
  des commandes au bot pour les stats. **Montrer la modification prévue dans PFlow Order avant de la faire.**

### Étape C
- Bouton « Retour sur WhatsApp » (`wa.me`) sur la page de confirmation de PFlow Order.
- Transfert humain : alerte dans la boîte de réception + WhatsApp au gérant si sa fenêtre de 24 h est
  ouverte. Notification par e-mail (présente dans le template UChat) : proposer une solution gratuite.
- Décision Vercel (plan Hobby non commercial) et webhook isolé pour pouvoir l'héberger ailleurs.

### Phase 2
- Événements PFlow Order (webhook entrant) : paiement validé, statuts, panier abandonné, avec templates
  Meta hors fenêtre de 24 h (un template peut mélanger bouton lien et bouton de réponse).
- Fonctions IA `annuler_commande` et `suivre_commande` (API PFlow Order), avec accord de Jules sur ce
  que l'app peut modifier.
- Messages vocaux : transcription (service payant à proposer, exception à la règle « coût quasi nul »).
- Instagram, Embedded Signup, messages différés et relances, statistiques, migration des clients UChat.
- Fonctions IA génériques et serveurs MCP.

Référence du template UChat de Jules : `docs/reference/template-uchat.md`.
