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
