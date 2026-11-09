# Version mobile (iPhone, app ajoutée à l'écran d'accueil)

Préparé le 9 novembre 2026. En dessous de **768 px** de large, l'app passe en version mobile ; au-dessus (ordinateur),
**rien ne change**.

## Ce qui s'utilise sur téléphone

- **Boîte de réception**, inspirée de WhatsApp (`src/components/inbox-mobile.tsx`) :
  - **liste en plein écran** : nom, extrait du dernier message, heure (« 14:05 », « Hier », « 07/11 »), badge
    **« 🔔 Attend l'équipe »** bien visible, **non lus en gras** avec un point vert. Les conversations qui attendent
    Jules sont **en haut**, avec le rappel « 🔔 N conversations attendent une réponse ».
  - **conversation en plein écran** :
    - flèche retour (le geste retour de l'iPhone marche aussi) ;
    - bulles en 16 px, mise en forme WhatsApp (*gras*, _italique_) ;
    - défilement jusqu'au dernier message ;
    - **« Reprendre la main » / « Rendre au bot »** en haut, 44 px ;
    - **zone de réponse collée en bas**, qui reste au-dessus du clavier iOS. La conversation se cale sur la partie
      visible de l'écran (`visualViewport`), qui rétrécit quand le clavier s'ouvre.
  - **depuis une notification push** : la conversation s'ouvre directement en plein écran.
- **État** : une colonne, avec dans l'ordre :
  - le bandeau d'alerte ;
  - les notifications (activer, appareils, notification de test) ;
  - le reste ;
  - le compte et la déconnexion.
- **Barre d'onglets en bas** : Boîte de réception, État. Elle tient compte de la barre d'accueil de l'iPhone (zones
  sûres, `viewport-fit=cover`).

**Toutes les autres pages** (éditeur, modèle maître, clients, démos, import, simulateur, accueil) affichent sur
téléphone « Cette page s'utilise sur ordinateur », avec un lien vers la boîte de réception.

## Règles respectées

- Champs en 16 px au moins : l'iPhone ne zoome plus en entrant dans un champ.
- Boutons et liens d'au moins 44 px de haut sur téléphone.
- Aucun défilement horizontal.
- « Non lu » : mémoire de l'appareil (`localStorage`), rien en base. Au premier passage, tout l'historique compte
  comme lu.
- Après connexion sur téléphone, sans page demandée : la boîte de réception.

## Vérification (9 novembre 2026)

Build de production, mode démo, Chromium en iPhone 390 × 844, mode app installée (`display-mode: standalone`) :
- **largeur 390 px** partout (aucun défilement horizontal) ; aucun champ sous 16 px ; aucun bouton sous 44 px ;
- liste, conversation, réponse envoyée, retour, ouverture par `?contact=` (notification) ;
- pages pour ordinateur : le message s'affiche sur téléphone, pas sur ordinateur ;
- ordinateur (1280 px) : boîte de réception classique, pas d'onglets.

**Limites du test**, à vérifier sur ton iPhone :
- le clavier iOS est **simulé** : partie visible réduite de 336 px, comme sur l'iPhone. La zone de réponse reste
  au-dessus (bas à 500 px pour un clavier à partir de 508 px) ;
- Chromium ne simule pas les zones sûres (encoche, barre d'accueil), qui valent 0 dans le test.

Tests : `src/lib/__tests__/inbox-view.test.ts`, qui couvre :
- l'ordre (celles qui attendent d'abord) ;
- les non lus ;
- la mise en forme WhatsApp ;
- l'heure.
