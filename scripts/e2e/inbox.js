/**
 * Boîte de réception dans un vrai navigateur, en mode démo (stockage en mémoire) et faux serveur Meta.
 *   node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
 *   WHATSAPP_STORE=memory WHATSAPP_APP_SECRET=secret-test WHATSAPP_VERIFY_TOKEN=phrase-test WHATSAPP_TOKEN=jeton-test \
 *     WHATSAPP_GRAPH_BASE=http://127.0.0.1:4556 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/inbox.js /tmp /tmp/envois-meta.jsonl
 */
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const LOG = process.argv[3] || '/tmp/envois-meta.jsonl';
const sent = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.body.type);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const step = (s) => console.log('✔', s);

  await p.goto('http://localhost:3123/inbox');
  await p.getByText('Mode démo :').waitFor();
  await p.getByLabel('Nom du client simulé').fill('Léa');
  await p.getByLabel('Message du client simulé').fill('bonjour');
  await p.getByRole('button', { name: 'Simuler un message client' }).click();
  const list = p.getByTestId('inbox-list');
  await list.getByText('Léa', { exact: true }).waitFor();
  await list.getByText('Cookies An Nou (démo)', { exact: false }).waitFor();
  step('message simulé : la conversation apparaît sous le resto');

  await list.getByText('Léa', { exact: true }).click();
  const thread = p.getByTestId('inbox-thread');
  await thread.getByText('bonjour').waitFor();
  await thread.getByText('Bienvenue chez Cookies An Nou', { exact: false }).waitFor();
  await thread.getByText('[🔗 Commander]', { exact: false }).waitFor();
  step('fil de la conversation : message du client et réponses du bot (bouton Commander)');

  await p.getByRole('button', { name: 'Reprendre la main' }).click();
  await p.getByText('Tu as la main', { exact: false }).waitFor();
  await thread.getByText('jusqu\'à ce que tu le relances', { exact: false }).waitFor();
  const before = sent().length;
  await p.getByLabel('Message du client simulé').fill('vous êtes là ?');
  await p.getByRole('button', { name: 'Simuler un message client' }).click();
  await thread.getByText('vous êtes là ?').waitFor();
  await p.waitForTimeout(800);
  if (sent().length !== before) throw new Error('le bot a répondu alors que la main est reprise');
  step('reprendre la main : le bot se tait (aucun envoi à Meta)');

  await p.getByLabel('Réponse').fill('Oui, je suis là, je regarde votre commande 🙂');
  await p.getByRole('button', { name: 'Envoyer' }).click();
  await p.getByText('Message envoyé.').waitFor();
  await thread.locator('div.whitespace-pre-wrap', { hasText: 'Oui, je suis là' }).waitFor();
  if (!sent().some((s) => s.body.text && s.body.text.body.startsWith('Oui, je suis là'))) throw new Error('réponse non envoyée à Meta');
  step('réponse à la main : envoyée à Meta, affichée « Équipe »');
  await p.screenshot({ path: OUT + '/c-inbox.png' });

  await p.getByRole('button', { name: 'Rendre au bot' }).click();
  await p.getByText('Le bot a repris la conversation.').waitFor();
  await p.getByLabel('Message du client simulé').fill('bonjour');
  await p.getByRole('button', { name: 'Simuler un message client' }).click();
  for (let i = 0; i < 30 && sent().length < before + 3; i++) await p.waitForTimeout(200);
  if (sent().length < before + 3) throw new Error('le bot ne répond pas après « Rendre au bot »');
  step('rendre au bot : il répond de nouveau');

  if (errors.length) throw new Error('Erreurs console : ' + errors.join(' | '));
  console.log('Aucune erreur dans la console.');
  await b.close();
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
