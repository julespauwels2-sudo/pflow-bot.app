# Démo permanente du numéro PFlow Démo — PROPOSITION (à valider par Jules avant toute PR)

8 novembre 2026. Remplace la démo générique d'UChat (pages faites avec ChatGPT, ancienne DA, faux dashboard) par
le **vrai produit**. Rien n'est codé tant que Jules n'a pas validé.

## 1. Inventaire : ce qui existe déjà dans le CRM (lu dans le code, dépôt Pflow-Crm, `main`)

| Élément | Où | Ce qu'il fait |
|---|---|---|
| **Page de commande de démo** | `order.pflow.fr/demo/commande` → `commande.html` + `js/commande-demo.js` | La **vraie** page de commande (même code que les vrais restos), servie **en mémoire** : les appels à la base vont vers une fausse adresse (`demo.pflow.invalid`), et **tous** les appels `/api/…` (notifier, paiement, livraison, contact) reçoivent une fausse réponse (`commande-demo.js`, l. 61-71). Bandeau « Démo : la commande arrive dans le Dashboard de démo ». Rien n'est écrit, aucun message ne part. |
| **Dashboard de démo** | `order.pflow.fr/demo` → `resto.html` + `js/dashboard-demo.js` | Le **vrai** tableau de bord, avec un faux client Supabase en mémoire : resto d'exemple, carte, stock, commandes du jour et des 4 dernières semaines ; une commande WhatsApp fictive arrive de temps en temps. Tout marche à l'écran, rien ne part ; recharger remet à zéro. |
| **Lien entre les deux** | `js/demo-commun.js` | Une commande passée sur la page de démo est rangée dans le navigateur (`localStorage`, 6 h) et apparaît dans le Dashboard de démo **du même téléphone**. Chaque prospect ne voit donc que **ses** commandes (plus les fictives). ⚠️ Aujourd'hui, seulement celles passées **après** l'ouverture du Dashboard (`dashboard-demo.js`, l. 481). |
| **Resto affiché** | `js/demo-commun.js` | Avec `?d=<code>` : le resto du prospect (démos personnalisées, `qg_demo_liens`, lecture seule). Sans code : « **Pizzeria du Port** » (pizzas, couleur `#E5735F`), nom changeable avec `?nom=`. |
| **Démos personnalisées** | PFlow Bots (mot-clé → bot du resto, 5 jours) + CRM (`?d=<code>`) | Inchangé. Correctif du mot-clé : PR n° 1 → **PR n° 2** de pflow-bot.app. |

**Conclusion** : le resto fictif **n'a pas besoin d'exister en base**. Il vit seulement dans le navigateur, comme
« Pizzeria du Port ». **Aucun SQL, aucune ligne dans `restaurants`.** C'est la meilleure garantie d'isolation.

## 2. Ce qu'on ajoute (2 PR : une dans le CRM, une dans PFlow Bots)

### PR CRM (Pflow-Crm), petite, sans SQL
1. **Le resto de démo PFlow** dans `js/demo-commun.js` : un 3e cas à côté de `?d=` et `?nom=`, l'adresse
   `?r=pflow` charge **Mint Burger** (nom, couleurs, logo, carte, options). « Pizzeria du Port » reste le resto
   par défaut (rien ne change pour les liens existants).
2. **Couleurs** (partie 5) : le resto garde **sa** couleur, le vert matcha, comme un vrai resto ; le **cadre
   PFlow** (bandeau de démo navy, badge rose, liens bleus, fond crème) montre que c'est PFlow. Seulement pour
   `?r=pflow` (les autres démos gardent leur couleur).
   **Options** : le preset doit aussi porter les **groupes d'options** (`groupes`, comme les vrais plats depuis
   qg57) ; aujourd'hui le format de démo ne passe que les suppléments. Petit ajout dans `demo-commun.js`.
3. **La commande du prospect visible dans le Dashboard** : à l'ouverture de `/demo?r=pflow`, le Dashboard affiche
   aussi les commandes de **ce téléphone** passées dans les 6 dernières heures pour ce resto (aujourd'hui :
   seulement celles arrivées après l'ouverture). Aucune autre donnée.
4. **Paiement** : sur `?r=pflow`, paiement **sur place uniquement** (aucun bouton de paiement en ligne affiché).
   Même s'il était affiché, `/api/paiement` est intercepté (aucun appel à Stripe).
5. Tests (`node:test`) : interception de tous les `/api/…` sur `/demo/commande` ; le preset `?r=pflow` ;
   la commande d'avant l'ouverture visible ; aucune requête vers la vraie base.

### PR PFlow Bots, sans SQL
1. Bot PFlow de base (`src/demos/pflow-bot.ts`, figé dans le code) : le parcours de la partie 3.
2. Tests : les 3 messages, les liens `?r=pflow`, « Je veux le mien » = transfert + alerte, démos personnalisées
   toujours prioritaires.

## 3. Le parcours WhatsApp, message par message

**Entrées**
- Message = **nom d'une démo personnalisée active** (« gwada food », « Démo Gwada Food »…) → **cette démo**
  (prioritaire sur tout, inchangé).
- **Salutation** (« Bonjour ») → accueil PFlow :
  - bulle 1 : « 👋 Bonjour ! Ici *PFlow* 🚀 On aide les restaurants à prendre leurs commandes sur WhatsApp… »
  - bulle 2 : « On vous a préparé une démo ? Écrivez simplement son nom ici 👇 Sinon, testez notre resto de démo : »
    boutons **[😋 Tester la démo]  [🍔 Découvrir PFlow]  [🎁 Obtenir ma démo]** (3 boutons au plus sur WhatsApp).
- **Intention de commander** (« Bonjour je veux commander », « commander », « menu », « la carte ») ou bouton
  **😋 Tester la démo** → **démo permanente**, directement.

**Démo permanente** (3 messages à la suite, avec l'indicateur « en train d'écrire » entre eux) :
1. « 😋 Mettez-vous à la place d'un client de *Mint Burger* 🍔🍵 : composez votre commande directement depuis sa
   carte, comme sur WhatsApp 👇 » — bouton lien **« Je commande »** →
   `https://order.pflow.fr/demo/commande?r=pflow`
2. « 📊 Côté restaurant, chaque commande arrive en direct sur le tableau de bord. Passez votre commande, puis
   regardez-la arriver 👇 » — bouton lien **« Voir le dashboard »** → `https://order.pflow.fr/demo?r=pflow`
3. « ✨ Et si vous aviez le vôtre ? PFlow Order peut être adapté à votre restaurant, votre carte et votre façon
   de travailler. Vous voulez en discuter ? » — boutons **[🙋 Je veux le mien]  [🍔 Découvrir PFlow]**

**Suites**
- **🙋 Je veux le mien** → transfert humain : « Super ! Jules, de PFlow, vous recontacte très vite 🙂 Dites-nous
  déjà le nom de votre resto. » + **alerte** à Jules (WhatsApp + boîte de réception), bot en pause 24 h pour ce
  contact. Comme « Obtenir ma démo » aujourd'hui.
- **🍔 Découvrir PFlow** → présentation (inchangée), avec **[😋 Tester la démo]  [🎁 Obtenir ma démo]**.
- **🎁 Obtenir ma démo** → transfert + alerte (inchangé).
- Pas d'IA sur le bot de base : **aucun coût**.

## 4. Isolation (garanties)

| Risque | Garantie |
|---|---|
| Vrai paiement | Resto fictif sans ligne en base ; paiement sur place seulement ; `/api/paiement` intercepté : aucun appel à Stripe possible. |
| Notification ou message à un vrai resto | `/api/notifier` intercepté ; aucune commande en base, donc aucun événement PFlow Order ; le resto fictif n'a pas de bot ni de numéro. |
| Événement vers un vrai canal PFlow Bots | Aucune vraie commande → rien à envoyer ; le canal PFlow Démo est en rôle `pflow` (qg87 et la route PFlow Bots ne le visent jamais). |
| Données d'un vrai client dans le dashboard | Faux client Supabase en mémoire ; commandes fictives générées dans le navigateur ; la commande du prospect ne sort pas de son téléphone. |
| Pages réelles touchées | Les scripts de démo ne font rien hors de `/demo` (vérifié en tête de chaque fichier) ; le preset `?r=pflow` est un ajout, les liens `?d=` et `?nom=` ne changent pas. |

⚠️ À tester à la livraison : sur iPhone et Android, les deux liens ouverts depuis WhatsApp doivent s'ouvrir dans
le **même navigateur** (sinon la commande n'apparaît pas dans le Dashboard). Si ce n'est pas le cas sur un
téléphone, plan B : le lien « Voir le dashboard » est aussi proposé **sur la page de confirmation** de la commande
de démo (même onglet, donc toujours visible).

## 5. Le resto de démo : Mint Burger (burgers au matcha)

Choisi par Jules. Pain brioché au matcha, produits locaux, à emporter et en livraison.

**Carte (7 produits)**

| Catégorie | Produit | Description | Prix |
|---|---|---|---|
| Burgers | **Le Mint Classic** | Bœuf 150 g, cheddar, salade, tomate, oignons rouges, sauce matcha-mayo | 12,50 € |
| Burgers | **Le Green Chicken** | Poulet croustillant, chou croquant, sauce matcha-citron vert | 12,50 € |
| Burgers | **Le Mint Smash** | Double smash de bœuf, double cheddar, oignons caramélisés | 15 € |
| Burgers | **Le Veggie Péyi** | Galette patate douce et giraumon, avocat, sauce chien | 12 € |
| À côté | **Frites de patate douce** | Fleur de sel, sauce au choix | 4,50 € |
| Boissons | **Matcha latte glacé** | Lait de coco, sirop de canne | 4,50 € |
| Desserts | **Cheesecake matcha-coco** | Maison | 5 € |

Prix calés sur les burgers de Guadeloupe (12 à 15 € le burger seul, 17 à 20 € en menu).

**Options (sur les 4 burgers)**
1. **Sauce** (obligatoire, un choix, incluse) : matcha-mayo, sauce chien, barbecue-piment doux.
2. **En menu** (facultatif, **+ 5 €**) : frites de patate douce + boisson 33 cl. Montre une option payante et le
   total qui change.

Un panier type : Mint Smash en menu (20 €) + Green Chicken (12,50 €) + cheesecake (5 €) = **37,50 €**. Les
commandes fictives du Dashboard sont tirées de cette carte (paniers de 8 à 45 €).

**Palette (matcha + DA PFlow)**

| Rôle | Couleur | Où |
|---|---|---|
| Couleur du resto | **Vert matcha foncé `#4E7A3A`** | Boutons « Ajouter » et « Commander », prix, onglets. Texte blanc dessus : contraste ≈ 5 pour 1 (lisible). |
| Matcha clair | `#A8C97F` | Tuiles des plats sans photo, pastilles, fond du logo |
| Fond | **Crème PFlow `#F3EEE6`** | Fond des pages |
| Texte et cadre | **Navy PFlow `#0A1236`** | Textes, bandeau « Démo PFlow » en haut des deux pages |
| Touche PFlow | **Rose PFlow `#FF4FB5`** | Badge « Démo PFlow », bouton « Voir le dashboard » de la confirmation. Texte navy dessus (le blanc sur ce rose est trop peu lisible). |
| Détails | **Bleu PFlow `#2AABFF`** | Liens, « Nouvelle commande » dans le Dashboard |

Le vert reste au resto (comme la couleur d'un vrai client) ; le navy, le rose et le bleu encadrent la démo et
rappellent PFlow. **Logo** proposé si tu n'en as pas : « Mint Burger » en navy, une feuille de matcha
`#4E7A3A` à la place du point du « i », sur fond matcha clair (SVG, hébergé sur order.pflow.fr).

## 6. Ce qui me manque (à récupérer par Jules)

1. **Relecture de la carte** : noms, descriptions, prix, options (partie 5).
2. **Un logo** pour Mint Burger. Sinon, je fais celui de la partie 5 (SVG simple).
3. **Des photos des plats** (libres de droits), facultatives. Sans photo, la page affiche des tuiles matcha
   clair, comme pour les vrais restos qui n'en ont pas.
4. **La palette** de la partie 5 : à valider (surtout le vert matcha foncé des boutons).
5. **Les textes des 3 messages** de la partie 3 : à valider, ou à modifier.
6. **Deux téléphones de test** (iPhone et Android) pour vérifier le lien entre la page et le Dashboard depuis
   WhatsApp.

Les anciennes adresses d'UChat ne servent plus à rien ici : on ne les reprend pas.

**Passage en actif de PFlow Démo** : bloqué tant que cette démo permanente n'existe pas (et tant que l'étape
de facturation de `bascule-pflow-demo.md` n'est pas réglée).
