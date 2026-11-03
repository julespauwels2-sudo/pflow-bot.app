# Parcours dans un vrai navigateur

Scripts Playwright qui déroulent l'interface de bout en bout (hors `npm test`).

Prérequis : Playwright et Chromium installés sur la machine (`npm i -g playwright` puis
`npx playwright install chromium`), et l'app lancée en production avec le mot de passe `test123` :

```bash
npm run build && BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
```

Puis, dans un autre terminal (le dossier passé en argument reçoit les captures d'écran) :

```bash
node scripts/e2e/clients.js /tmp
node scripts/e2e/message-bulles.js /tmp
node scripts/e2e/fiche-infos.js /tmp
```

Chaque script part d'un navigateur vierge et charge le resto d'exemple.
