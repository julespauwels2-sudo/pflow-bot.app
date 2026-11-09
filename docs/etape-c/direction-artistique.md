# Direction artistique de PFlow Bots (9 novembre 2026)

Référence : pflow.fr et pflow.fr/demo (dépôt `site-pflow` : couleurs, polices, logo, icônes).
**Aucun changement de fonctionnement** : seulement les couleurs, polices, arrondis, ombres, le logo, les icônes et
l'écran de lancement.

## Thème centralisé

Un seul endroit : `src/app/globals.css` (bloc `@theme` + utilitaires). Les composants n'utilisent que ces jetons.

| Jeton | Valeur | Usage |
|---|---|---|
| `navy` / `navy-2` / `navy-3` | #101B4D / #1B2A6B / #0A1447 | texte, en-têtes |
| `pink` / `pink-2` / `pink-3` | #FF4FB5 / #FF7CCB / #F03CA5 | actions, non lus, onglet actif |
| `blue`, `cyan` | #2A8BFF, #74DDFB | avatars, filet de marque |
| `page`, `muted`, `line`, `rule` | comme le site | fonds, textes secondaires, traits |
| `bulle-bot`, `bulle-humain`, `chat` | bleu clair, rose clair, gris lavande | conversation |
| `font-title` / `font-sans` | **Fredoka** / **Manrope** (mêmes fichiers que le site, `src/app/fonts`) | titres / texte |
| `rounded-card` 24 px, `--radius-field` 14 px, `--radius-sheet` 28 px | | cartes, champs, en-têtes iPhone |
| `shadow-card`, `shadow-pop`, `shadow-bouton`, `shadow-bloc` | ombres du site | cartes, bouton rose, blocs navy |
| `bg-brand`, `bg-navy-grad`, `bg-avatar`, `bg-filet`, `bg-chat-motif` | dégradés du site | bouton rose, bandeaux navy, avatars… |

## Ce qui change

- **Logo** (`src/components/logo.tsx`) : le P en verre liquide (icône du site), « flow » en rose, badge « BOTS » dessiné
  comme le badge ORDER. Version claire et version sur fond navy.
- **iPhone** :
  - boîte de réception : en-tête navy avec le logo, liste en carte arrondie, avatars dégradés, non lus en rose, bandeau
    « conversations qui attendent » en rose ;
  - conversation : en-tête navy, fond à motif léger, bulles bot (bleu) / toi (rose) / client (blanc), bouton d'envoi rose ;
  - État : même en-tête navy, bouton « Actualiser » dans l'en-tête ;
  - barre d'onglets : verre dépoli, onglet actif en rose avec une pastille ;
  - connexion et « page pour ordinateur » : plein écran navy avec le logo.
- **Icône de l'app** : l'icône du site (P en verre liquide sur navy) ; icône iPhone = `apple-touch-icon` du site ;
  icône Android « maskable » avec marge.
- **Écran de lancement** : 11 tailles d'iPhone (`public/splash`), fond navy, logo, « PFlow Bots ». Barre d'état
  transparente (les en-têtes navy passent dessous). Nom de l'app : « PFlow Bots ».
- **Ordinateur** : mêmes couleurs et polices, disposition inchangée (logo, filet de marque sous l'en-tête, boutons
  roses dégradés, champs arrondis).

## Captures

`docs/captures/direction-artistique/` : `iphone-avant.png`, `iphone-apres.png` (390 × 844, app installée),
`ordinateur-avant-apres.png` (1280 × 800), `ecran-de-lancement.png`.

**À vérifier sur l'iPhone** : l'écran de lancement et la nouvelle icône n'apparaissent qu'après avoir **supprimé puis
réinstallé** l'app (Partager → Sur l'écran d'accueil). Les notifications push sont à réactiver après la réinstallation.

## Refonte sombre (9 novembre 2026, soir) : toutes les pages comme pflow.fr/demo

Styles relevés dans le navigateur sur `demo.html` et `index.html` du dépôt du site (pflow.fr n'est pas joignable
depuis la session) :
- fond `#0A1236` avec halos : bleu `rgba(42,171,255,.3)` en haut à gauche, rose `rgba(255,79,181,.18)` à droite ;
- texte crème `#F3EEE6`, secondaire à 72 %, traits crème à 14 % ;
- titres Fredoka 700 ; texte Manrope ;
- bouton rose : dégradé `#FF74C6 → #FF4FB5 → #F03CA5`, rayon 999 px, ombre `0 18px 40px -12px rgba(255,79,181,.75)` ;
- bouton secondaire : fond crème à 4 %, trait crème à 14 %.

Appliqué à **toutes** les pages (Accueil, Clients, fiche client, Modèle maître, Agent IA, Démos, Import, État, Boîte de
réception, Simulateur, éditeur de flux, Connexion), ordinateur et iPhone :
- thème central (`src/app/globals.css`) : fond navy + halos fixes, jetons `ink`, `muted`, `line`, `rule`, `surface`
  passés en clair-sur-sombre, contrôles natifs en sombre (`color-scheme: dark`), éditeur de flux React Flow en sombre ;
- cartes « verre » (translucides, flou derrière, coins de 26 px), badges colorés (Fait, En cours, Actif, Test…) ;
- en-tête collant en verre sombre avec le logo PFlow BOTS, navigation lisible ;
- formulaires, tableaux, éditeur, boîte de réception (bulles bot bleues, tes réponses roses) harmonisés ;
- le **téléphone du simulateur** garde volontairement le rendu clair de WhatsApp (c'est un aperçu de téléphone).

**Contrastes** (WCAG, sur une carte du fond navy) : texte crème 14,1:1 ; texte secondaire 7,9:1 ; cyan 10,4:1 ; vert
10,6:1 ; rose clair 7,0:1 ; bleu 6,5:1 ; corail 5,8:1 ; rose 5,4:1. Blanc sur le bouton rose : 3,0:1, comme sur
pflow.fr (suffisant pour du texte gras de grande taille, pas pour du petit texte : les boutons roses restent en gras).

Aucun changement de fonctionnement. Captures avant/après de chaque page : `docs/captures/da-sombre/` (1280 px et
390 px).

