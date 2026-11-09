# Audit : ce que le CRM fait pour prévenir Jules (9 novembre 2026, lecture seule)

Méthode : code de `Pflow-Crm` sur `main` (commit 40f2605), puis vérification **en lecture seule** dans la base de
production (tâches pg_cron, réglages, alertes des 30 derniers jours, notifications envoyées). Rien n'a été modifié.
Les chemins de code partent de `repo/`.

## En bref

- **Le seul canal vers Jules est la notification push de l'app « QG » du CRM** (table `qg_notifs` → fonction
  Supabase `qg-notifier` → appareils de `qg_push` → `sw-qg.js`). Elle ne passe ni par Vercel ni par UChat.
- **Le WhatsApp vers Jules est coupé depuis le 26 octobre**, à deux endroits :
  - code : `api/supervision.js:335-340` (`var WHATSAPP_JULES = false`) ;
  - base : `sup_config.whatsapp_pause_jusqu_a = 2100-01-01` (posé par `sql/qg22-alertes-push.sql:89,96`), vérifié en
    production.
- **Aucun e-mail, SMS, Slack ni Telegram.** Aucun cron Vercel : tout le planifié est dans pg_cron (19 tâches actives,
  toutes « succeeded » sur les 3 derniers jours).
- 🔴 **Trou important : une commande non acceptée ne prévient plus Jules.** La règle détecte bien (12 fois en 30 jours),
  mais elle n'est pas dans la liste des alertes envoyées en push, et le WhatsApp est coupé. Exemples réels :
  - 8 nov. : **Cookies An Nou**, une commande a attendu **6 h 19** ;
  - 1er nov. : **Mexico**, une commande programmée (passée la veille à 23 h 14 pour 11 h 35) a attendu **4 h 51** après
    son heure (dashboard fermé ; corrigé le 9 nov. : l'alerte comptait depuis la veille) ;
  - 6, 7 et 8 nov. : ag_pizzaa et Mexico, 10 à 53 min.
  Dernière alerte « commande pas acceptée » réellement envoyée à Jules : **22 octobre** (par WhatsApp/UChat).
- **Appareils abonnés au push du QG : 1 seul** (un iPhone, vu le 7 nov.), contre 5 fin octobre.

## Les 4 alertes demandées

| Alerte | Existe ? | Comment Jules est prévenu | Quand | Marche en production ? |
|---|---|---|---|---|
| Commande non acceptée après X min | **Oui**, règle `COMMANDE_EN_ATTENTE`, X = **10 min** | Affichage dans le CRM (onglet Supervision, pastille) + proposition « À valider » de l'agent Santé. **Pas de push, pas de WhatsApp** | pg_cron toutes les 2 min | Détection : oui. **Prévenir Jules : non** |
| Resto sans commande depuis X jours | **Non** (en jours). Deux règles voisines : `SILENCE` (heures) et `cl_decroche` (semaine) | Affichage CRM / proposition « À valider » seulement | 2 min / chaque jour à 7 h 15 | Pas d'alerte push |
| Résumé du matin | **Oui** | **Push** « Dimanche : 36 missions… » | Chaque jour à 8 h (heure réglable) | **Oui** (envoyé chaque jour, dernier le 8 nov.) |
| Paiement Stripe échoué / abonnement résilié | **Oui** (abonnement PFlow seulement) | **Push** « Paiement refusé : … » / « Abonnement arrêté : … » + proposition de message au client | Temps réel (webhook Stripe) | Branché (variables présentes dans Vercel) mais **jamais déclenché** : 0 facture d'abonnement en base |

### 1. Commande non acceptée

- Règle : `sql/s8-supervision.sql:135-136` (seuil 10 min, niveau critique) ; détection `s8:480-492` (commandes
  `nouvelle` depuis plus de 10 min, hors tests).
- Affichage : onglet Supervision `js/supervision.js:90-102`, pastille `index.html:94`. Proposition au resto (Jules
  l'envoie lui-même) : `sql/s11-agents.sql:827-829`.
- Push : le déclencheur `qg_alertes_push` (`qg22:46`, `qg30:76`) ne pousse que les règles de
  `qg_settings.alertes_push`. En production : `SERVICE, BOT_INJOIGNABLE, BOT_ERREURS, PONT_ERREURS,
  RESTO_HORS_LIGNE, CARTE_VIDE`. **`COMMANDE_EN_ATTENTE` n'y est pas**, et aucun écran ne permet de la changer.
- Règle voisine : `COMMANDE_BLOQUEE` (en préparation depuis plus de 2 h) : affichage seulement.

### 2. Resto sans commande depuis X jours

- N'existe pas en jours. Le plus proche :
  - `SILENCE` (`s8:137-138`, logique `s8:507-537`) : pendant l'ouverture, moins de commandes que d'habitude
    (sur 12 h au plus, après 20 commandes et 7 jours d'historique). Affichage + agent Santé ;
  - `cl_decroche` (`sql/qg35-clients.sql:88-105`) : la semaine écoulée fait au plus la moitié de l'habitude.
    Proposition « À valider » seulement, chaque jour à 7 h 15.
- Affichage seul : colonne « Dernière commande » de la Supervision (`js/supervision.js:283`).

### 3. Résumé du matin

- `qg_matin_contenu()` / `qg_matin_tic()` (`sql/qg30-notifs-courtes.sql:103-174`) : missions, tâches, rendez-vous,
  « à valider », salle. **Les alertes de supervision n'y sont pas.**
- Envoi : push via `qg_notif_poser('matin:…')` (`qg30:171`), tâche pg_cron `qg-notifs` (toutes les 2 min, une fois
  par jour à partir de 8 h). Vérifié : envoyé chaque jour (1 appareil le 8 nov.).
- L'ancien résumé WhatsApp des agents (`api/agents.js:524-556`) est éteint.

### 4. Stripe

- Webhook `api/paiement.js:756-771` (`invoice.payment_failed`) et `:773-780` (`customer.subscription.deleted`) →
  fonctions `qg_abo_echec` / `qg_abo_fin` (`sql/qg19-abonnement-stripe.sql:185-224`) → push immédiat.
- Rattrapage par la supervision : **seulement** les résiliations ; un échec de paiement manqué n'est pas rattrapé.
- Paiements des **clients des restos** (cartes refusées, litiges, compte Stripe incomplet : règles
  `PAIEMENT_ECHECS`, `LITIGE`, `STRIPE_INCOMPLET`) : affichage CRM seulement, pas de push.

## Les autres alertes (résumé)

| Alerte | Canal |
|---|---|
| Serveur / service en panne (base, paiement, IA, WhatsApp UChat) | Push (marche même si Vercel tombe : le chien de garde est dans la base) |
| Bot d'un resto injoignable, erreurs du bot ou du pont, carte vide, resto hors ligne | Push |
| Crédit OpenAI épuisé | Push (crédit bas : affichage seulement) |
| Dashboard fermé, pause longue, rupture longue, agent IA à recopier | Affichage CRM seulement |
| Instagram (contenu à valider, échec de publication, jeton Meta…) | Push |
| Nouvelle commande, stock bas | Push **au resto** (pas à Jules) |

**À savoir avant l'arrêt d'UChat** : les sondes de la supervision interrogent encore UChat (`sondeWhatsapp`,
`sondeBot`). Si UChat ferme avec la clé en place : push « Panne : WhatsApp (UChat) » et « Bot injoignable » pour
chaque resto ; si la clé est retirée : état « inconnu » permanent et `/etat` peut répondre 503. À adapter avec la
bascule (PR CRM séparée, plus tard).

## Recommandation

**Ne pas créer de nouveau push dans le CRM : il en a déjà un, qui marche.** Le problème n'est pas le canal, c'est
le **choix des alertes envoyées**.

1. **Tout de suite (correctif d'1 ligne, réglage du CRM, à jouer par Jules)** : ajouter les alertes critiques qui
   concernent l'argent des restos à la liste du push. SQL proposé, **non appliqué** :

   ```sql
   -- Réglage existant du QG (une ligne, colonne text[]) : quelles alertes de supervision partent en push vers Jules.
   update public.qg_settings
      set alertes_push = array_cat(alertes_push, array['COMMANDE_EN_ATTENTE', 'PAIEMENT_ECHECS', 'LITIGE', 'SILENCE'])
    where not ('COMMANDE_EN_ATTENTE' = any(alertes_push));
   ```

   Effet : la prochaine « commande pas acceptée » arrive en notification sur l'iPhone, comme les pannes.
   Et réinstaller les notifications du QG sur les appareils qui les ont perdues (1 seul abonné aujourd'hui).

2. **Ensuite : un seul centre d'alertes, l'app PFlow Bots**, pour tout ce qui demande d'agir sur un resto
   (conversations, commandes, pannes, paiements). Raisons :
   - c'est l'app que Jules ouvre en service (boîte de réception) et dont le push est déjà vérifié sur son iPhone ;
   - après l'arrêt d'UChat, les bots, les commandes WhatsApp et leurs alertes vivent dans PFlow Bots ;
   - **même base Supabase** : PFlow Bots peut **lire** la table `alertes` du CRM (lecture seule) et pousser les
     nouvelles alertes critiques, avec un lien vers la Supervision du CRM. Aucune modification du CRM, une seule table
     `bot_` pour retenir ce qui a déjà été poussé, une tâche planifiée Vercel (chaque minute).
   - Le QG garde ce qui est personnel (résumé du matin, tâches, sport, rendez-vous). Une fois PFlow Bots en place, on
     vide `alertes_push` du QG pour éviter les doublons.

   Coût : ≈ 1 jour (après Embedded Signup), aucun frais.

Pas de code pour ce point (demande de Jules).
