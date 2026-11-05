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
node scripts/e2e/dossiers.js /tmp
node scripts/e2e/modele.js /tmp
node scripts/e2e/evenements.js /tmp
node scripts/e2e/bot.js /tmp
node scripts/e2e/simulateur.js /tmp
```

Agent IA, sans clé ni coût, avec un faux serveur Anthropic local :

```bash
node scripts/e2e/fake-anthropic.js /tmp/requetes-ia.jsonl
```
```bash
npm run build && ANTHROPIC_API_KEY=cle-de-test ANTHROPIC_BASE_URL=http://127.0.0.1:4555 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
```
```bash
node scripts/e2e/agent-ia.js /tmp /tmp/requetes-ia.jsonl
```

Chaque script part d'un navigateur vierge et charge le resto d'exemple.

## Canaux WhatsApp et Instagram, sans Meta

Faux serveur Meta (note chaque envoi, n'envoie rien) et app en mode mémoire. **Retirer `.env.local`
le temps du build** (sinon les variables Supabase sont figées dans l'app et la connexion est exigée).

```bash
node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
```
```bash
npm run build && CHANNELS_STORE=memory WHATSAPP_APP_SECRET=secret-test WHATSAPP_VERIFY_TOKEN=phrase-test WHATSAPP_TOKEN=jeton-test WHATSAPP_GRAPH_BASE=http://127.0.0.1:4556 INSTAGRAM_APP_SECRET=secret-ig INSTAGRAM_VERIFY_TOKEN=phrase-ig INSTAGRAM_TOKEN=jeton-ig INSTAGRAM_GRAPH_BASE=http://127.0.0.1:4556 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
```
```bash
node scripts/e2e/whatsapp.js /tmp/envois-meta.jsonl
```
```bash
node scripts/e2e/instagram.js /tmp/envois-meta.jsonl
```

La boîte de réception (`inbox.js`) se lance sur un serveur **fraîchement démarré** (elle simule la
cliente « Léa », que `whatsapp.js` crée aussi) :

```bash
node scripts/e2e/inbox.js /tmp /tmp/envois-meta.jsonl
```

## Démos sur le numéro PFlow

Page Démos et simulateur du numéro PFlow (mode local, serveur fraîchement démarré, sans `.env.local`) :

```bash
node scripts/e2e/demos.js /tmp
```

Numéro PFlow par le webhook (même serveur que `whatsapp.js`, mode mémoire + faux Meta) :

```bash
node scripts/e2e/numero-pflow.js /tmp/envois-meta.jsonl
```
