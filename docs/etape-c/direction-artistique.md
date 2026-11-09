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

## Charte PFlow (9 novembre 2026, nuit) : la référence

> **Décision de Jules (PR n° 20 validée)** : cette charte est la référence pour **toute nouvelle page** de PFlow Bots.
> Aplats (nuit, bleu, rose), Anton en majuscules et Plus Jakarta Sans, cartes blanches à texte nuit, pills roses à
> texte nuit, ombres plates ; pour le petit texte d'accent sur blanc, les teintes foncées **`#C8157F`** (rose) et
> **`#0067B8`** (bleu), validées par Jules.

### Règles pour une nouvelle page

- Cadre : `AppShell` (en-tête P bulle + pill PFLOW BOTS) ; sur iPhone, `MobileHeader` et la barre d'onglets.
- Titre de page : `<h1 className="text-5xl">` en Anton, **un seul segment** en `text-rose`.
- Contenu en `Card` (carte blanche) ; blocs mis en avant en `aplat-bleu` ou `aplat-rose` ; bloc sombre dans une carte
  en `aplat-nuit`.
- Actions : `Button` (pill rose, texte nuit) ; secondaire : `variant="secondary"` (contour 2 px). Statuts : `Badge`.
  Messages : `Notice`. Champs : `Input`, `Select`, `Textarea` (toujours blancs, texte nuit).
- Couleurs de texte : `text-ink`, `text-muted`, `text-rose`, `text-bleu`, `text-ok`, `text-alerte` (elles s'adaptent
  à la surface ; dans une carte blanche, le rose et le bleu deviennent `#C8157F` et `#0067B8`).
- Interdit : couleur, police ou ombre écrite en dur ; dégradé, halo, flou (`backdrop-blur`), ombre floue ; italique ;
  vert, corail, ambre ; texte blanc sur rose.

La **charte de Jules** (charte de contenu PFlow, la même que pour Instagram) passe avant tout ce qui avait été déduit
du site. Elle remplace la « refonte sombre » (halos, Fredoka, cartes en verre), qui n'est plus utilisée.

Règles appliquées à l'app (`src/app/globals.css`, seul endroit où vivent couleurs, polices, arrondis et ombres) :
- **couleurs** : nuit `#0A1236` (fond), rose `#FF4FB5` (accent, actions), bleu `#2AABFF`, reflet `#74DDFB`, blanc ;
  crème `#F3EEE6` réservé au ticket de commande. Aucun vert, corail ni ambre (succès = reflet, alerte = rose) ;
- **aucun dégradé, aucun halo, aucun flou** : fonds en aplat, en-têtes et barres sans transparence ;
- **titres en Anton, en majuscules**, un seul segment en rose par titre ; **texte en Plus Jakarta Sans** (400, 600,
  700, 800) ; aucune italique ni faux gras (`font-synthesis: none`). Fichiers repris du CRM (`src/app/fonts`, OFL) ;
- **ombres plates décalées** `rgba(0,0,0,.28)` (cartes 8 × 10 px, boutons 3 × 4 px), jamais floues ;
- **cartes blanches** à texte nuit sur le fond nuit (coins de 28 px) ; blocs en aplat bleu ou rose à texte nuit ;
- **boutons** : pill rose en aplat, texte nuit, Plus Jakarta 800 en majuscules ; secondaires : contour 2 px ;
- **badges** : pills en aplat (reflet « Fait / Actif / Présente », rose « En cours / À faire », bleu « Info ») ;
- **logo** : le P bulle (mascotte, seul élément 3D) suivi d'une pill blanche « PFLOW BOTS » ;
- éléments de la charte : **grille de points** (en haut à droite, 35 %), **ticket de commande** crème au bord dentelé
  sur l'accueil ;
- boîte de réception : fil nuit à grille de points, bulles en aplat (client blanc, bot bleu, équipe rose) ;
- éditeur de flux : toile nuit en aplat, blocs en cartes blanches, couleurs des blocs dans la palette ;
- le **téléphone du simulateur** garde le rendu WhatsApp (c'est une maquette de l'interface).

Couleurs « relatives » : `text-ink`, `text-muted`, `text-rose`, `text-bleu`… changent selon la surface (blanc sur le
fond nuit, nuit dans une carte blanche), pour garder un contraste suffisant partout.

**Contrastes** (WCAG) :
- sur le fond nuit : blanc 18,2:1 ; texte secondaire (blanc 72 %) 9,7:1 ; reflet 11,7:1 ; bleu 7,3:1 ; rose 6,1:1 ;
- dans une carte blanche : nuit 18,2:1 ; texte secondaire 6,4:1 ; rose foncé `#C8157F` 5,4:1 ; bleu foncé `#0067B8`
  5,8:1 (ces deux teintes foncées servent seulement au texte sur blanc, le rose vif n'y fait que 2,9:1) ;
- boutons et badges : nuit sur rose 6,1:1, nuit sur bleu 7,3:1, nuit sur reflet 11,7:1 (plus de blanc sur rose).

Aucun changement de fonctionnement (452 tests). Captures prises sur la preview Vercel de la PR :
`docs/captures/charte/`.

### Preview Vercel : pourquoi elle répondait 503

Toutes les variables de PFlow Bots sont réservées à la **production**. Une preview n'en avait aucune : la protection
de `src/proxy.ts` répondait « Accès non configuré : définissez BASIC_AUTH_PASSWORD » (503) sur **toutes** les pages.
Correctif : variable `BASIC_AUTH_PASSWORD` ajoutée dans Vercel pour **Preview seulement** (la production n'est pas
touchée). Les previews tournent en mode navigateur (aucune donnée réelle, aucun canal branché) et restent aussi
derrière la connexion Vercel.
