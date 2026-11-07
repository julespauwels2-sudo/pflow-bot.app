# C6 — Basculer un vrai numéro sur PFlow Bots (coexistence), et revenir à UChat

Préparé le 7 novembre 2026, sans rien toucher chez Meta. Exemple : **Cookies An Nou**. Même méthode pour
chaque resto, et pour le numéro des démos (**PFlow Démo**, partie 5).

**Principe de sécurité** : tant que le canal d'un resto est en **test**, PFlow Bots ne répond qu'aux
numéros de la liste de test, et **PFlow Order envoie les vraies commandes à UChat** (double garde-fou,
qg87 + route PFlow Bots). Seul **« actif »** fait basculer les clients et les commandes. Le retour en
arrière est un clic : **« Repasser en test »** sur la page État.

## 0. Prérequis (déjà faits ou à faire une fois)

- [x] App PFlow Bots en **Live**, webhook vérifié, champ **`messages`** abonné.
- [ ] Champ **`smb_message_echoes`** abonné (WhatsApp → Configuration → Champs du webhook) : en
      coexistence, les messages que le gérant envoie depuis l'appli WhatsApp Business arrivent ainsi au
      bot, qui se met en pause 12 h pour ce client (déjà codé).
- [ ] PR n° 76 de Pflow-Crm fusionnée et SQL qg85 → qg86 → qg87 joués (voir le résumé du 7 novembre).
- [ ] Variables Vercel : `PFLOW_BOTS_URL` + `PFLOW_BOTS_SECRET` (les deux projets), `PFLOW_ORDER_PONT_CLE`
      (projet PFlow Bots, = `PONT_CLE` du CRM : suivi et annulation par l'IA).
- [ ] Fiche de Cookies An Nou complète dans PFlow Bots (jours de livraison par zone, FAQ, carte pour l'IA).
- [ ] Modèle maître complété (page **Modèle** → **Ajouter les flux manquants**) : flux d'annulation, de
      remboursement, de rappel, de suivi.

## 1. Diagnostic du vrai numéro (5 min, lecture seule)

Dans **WhatsApp Manager** (business.facebook.com → Comptes WhatsApp) :

1. Le numéro de Cookies An Nou est-il dans **ton** portefeuille ? Note : **ID du numéro** (Phone number ID),
   **WABA** (compte WhatsApp) et **compte de messagerie** (s'il apparaît à part, comme pour le test).
2. Est-il **en coexistence** (le resto utilise encore l'appli WhatsApp Business sur son téléphone) ? Dans
   WhatsApp Manager, la ligne du numéro indique « WhatsApp Business app » / « Coexistence ».
3. Quelles apps sont abonnées au WABA ? (UChat, PFlow Bots ?) — après l'étape 2, le bouton **« Tester
   l'accès du token »** de la page État l'affiche.

**Trois cas :**

| Cas | Ce qu'on fait |
|---|---|
| **A.** Numéro dans ton portefeuille, déjà sur l'API (avec UChat), en coexistence ou non | Parties 2 à 4 : on **ajoute** PFlow Bots au même numéro. Rien à réenregistrer. |
| **B.** Numéro dans le portefeuille d'UChat ou du resto (pas le tien) | Il faut d'abord que le resto (ou UChat) partage le WABA avec ton portefeuille. **Dis-le-moi** : on regarde ensemble. |
| **C.** Numéro seulement dans l'appli WhatsApp Business (pas encore sur l'API) | La coexistence passe par l'**Embedded Signup** de Meta (v4 ; la v2 s'arrête le 15 octobre 2026), avec une configuration « Facebook Login for Business » dans l'app. **Pas encore codé** : à faire ensemble si ce cas arrive. |

## 2. Relier le numéro à PFlow Bots, en TEST (cas A)

1. **Paramètres de l'entreprise → Utilisateurs système → `pflow-bots-serveur` → Attribuer des éléments** :
   le **compte WhatsApp** du numéro **et** son **compte de messagerie**, en **contrôle total** (deux
   éléments, comme pour le numéro de test). Le token actuel couvre « tous les objets » : pas besoin de le
   régénérer.
2. **Abonner l'app PFlow Bots au WABA** (Graph API Explorer, app PFlow Bots) :
   `POST <WABA_ID>/subscribed_apps` puis `GET <WABA_ID>/subscribed_apps` (PFlow Bots doit apparaître).
   ⚠️ À partir de là, **UChat et PFlow Bots reçoivent tous les deux** les messages de ce numéro. En test,
   PFlow Bots ne répond qu'à ton numéro (tu recevras donc aussi la réponse d'UChat : normal pendant le test).
3. **Créer le canal en test** (Supabase → SQL Editor ; remplacer les `<…>`) :

```sql
insert into public.bot_canaux
  (restaurant_id, role, plateforme, compte_id, waba_id, messaging_account_id, numero_affiche,
   mode_declenchement, coexistence, tel_alerte, etat, test_numeros)
values
  ('f610eae4-84f4-4a81-bccf-9963a65e0bf7', 'resto', 'whatsapp', '<PHONE_NUMBER_ID>', '<WABA_ID>',
   '<MESSAGING_ACCOUNT_ID ou null>', '<+590 … (Cookies An Nou)>',
   'toujours', <true si coexistence, sinon false>, '<numéro du gérant, ex. 590690…>', 'test', array['590690938108']);
```

4. Page **État** → **Tester l'accès du token** : toutes les lignes du nouveau canal en **OK**.
5. Depuis **ton** numéro : « Bonjour », une question, « je veux commander », « elle arrive quand ma
   commande ? ». Page État → **Événement de commande de test** : choisis le canal du **vrai numéro** dans la
   liste « Canal », puis un événement : le message arrive sur ton téléphone depuis le vrai numéro.
6. En coexistence : envoie un message **depuis l'appli WhatsApp Business** du resto à ton numéro, puis
   écris au bot : il doit se taire 12 h pour toi (pause « le gérant a répondu »).

## 3. Basculer (le jour J, de préférence en heure creuse)

1. **Couper le bot UChat** de ce numéro (UChat → le bot → le désactiver, ou retirer l'app UChat du WABA :
   `DELETE <WABA_ID>/subscribed_apps` avec le token d'UChat… le plus simple : désactiver le bot dans UChat).
   Sinon les clients reçoivent deux réponses.
2. Page **État → Canaux** → Cookies An Nou (vrai numéro) → **Passer en actif** (confirmation).
   - le bot répond à tous les clients ;
   - PFlow Order envoie les événements des vraies commandes à PFlow Bots (qg87 voit le canal actif).
3. Vérifier dans l'heure : un client écrit → réponse ; une vraie commande → « Commande enregistrée » sur
   WhatsApp ; page État → derniers événements ; journal du bot dans le CRM (`pflow_bots: pris`).
4. Garder le canal du numéro de test en **test** (il ne passe jamais en actif : bloqué).

## 4. Revenir à UChat en cas de problème (2 minutes)

1. Page **État → Canaux** → **Repasser en test** (ou **Couper**) : PFlow Bots ne répond plus aux clients,
   et **PFlow Order renvoie aussitôt les événements de commande à UChat**.
2. **Réactiver le bot UChat** du numéro.
3. Facultatif : `DELETE <WABA_ID>/subscribed_apps` avec le token de PFlow Bots pour ne plus recevoir les
   messages (sinon ils arrivent et sont ignorés, sauf pour les numéros de test).
4. Rien à changer dans le CRM, ni dans Vercel.

## 5. Numéro des démos « PFlow Démo » (+590 691 26 68 53)

Le code des démos est prêt (mot-clé de démo → bot du prospect 5 jours, bot PFlow de base sinon). Il
manque seulement le canal du numéro, avec le rôle **`pflow`** (jamais d'événement de commande, jamais de
vrai lien de commande : page de démonstration du CRM).

1. WhatsApp Manager : note l'**ID du numéro**, le **WABA** et le **compte de messagerie** de PFlow Démo.
   S'il n'est pas encore sur l'API (seulement dans l'appli) : cas C de la partie 1.
2. Attribuer ces deux éléments à `pflow-bots-serveur` (contrôle total) ; abonner l'app PFlow Bots au WABA.
3. Canal (SQL Editor) :

```sql
insert into public.bot_canaux
  (restaurant_id, role, plateforme, compte_id, waba_id, messaging_account_id, numero_affiche,
   mode_declenchement, coexistence, tel_alerte, etat, test_numeros)
values
  (null, 'pflow', 'whatsapp', '<PHONE_NUMBER_ID>', '<WABA_ID>', '<MESSAGING_ACCOUNT_ID ou null>',
   '+590 691 26 68 53 (PFlow Démo)', 'toujours', <true si coexistence>, '590690938108', 'test',
   array['590690938108']);
```

4. Test depuis ton numéro : « Bonjour » (bot PFlow de base), puis le **mot-clé d'une démo** (ex. « GWADA
   FOOD ») : l'Accueil de la démo, avec le bouton vers la page de démonstration.
5. Page État → **Passer en actif** : tous les prospects peuvent écrire. (Un numéro +590 n'est pas bloqué ;
   seul un numéro de test Meta +1 555 l'est.)
6. Mettre ce numéro sur les cartes de visite, Instagram (@pflow.gp) et la page /demo du site.

## Ce qui n'est pas encore fait (à décider)

- **Embedded Signup** (cas C) : seulement si un numéro n'est pas déjà sur l'API.
- **Hébergement** : Vercel Hobby interdit l'usage commercial → décision avant le premier client actif
  (voir `docs/hebergement.md`).
- ag_pizzaa : copie locale de l'Accueil à relier au modèle avant sa bascule (`docs/plan.md`).
