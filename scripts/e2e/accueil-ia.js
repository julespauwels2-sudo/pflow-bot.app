/**
 * Scénarios de Jules du 7 novembre 2026 dans le simulateur (faux serveur Anthropic, voir agent-ia.js) :
 * prénom incertain → « Hello ! », accueil complet une fois puis version courte, « je veux commander » →
 * CTA - Commander, vraie question → IA, mot-clé dans une phrase longue → IA.
 *
 *   node scripts/e2e/fake-anthropic.js /tmp/requetes-ia.jsonl
 *   npm run build && ANTHROPIC_API_KEY=cle-de-test ANTHROPIC_BASE_URL=http://127.0.0.1:4555 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/accueil-ia.js /tmp /tmp/requetes-ia.jsonl
 */
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const LOG = process.argv[3] || '/tmp/requetes-ia.jsonl';
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined));
  const step = (s) => console.log('✔', s);
  const chat = () => p.locator('[data-testid="chat"]');
  const journal = () => p.locator('[data-testid="journal"]');
  const say = async (text) => {
    const before = await chat().locator('*').count();
    await p.getByLabel('Message du client').fill(text);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await p.waitForFunction((n) => document.querySelectorAll('[data-testid="chat"] *').length > n, before);
  };
  const lastTurnHas = async (text) => {
    try {
      await journal().locator('li').first().getByText(text, { exact: false }).first().waitFor({ timeout: 5000 });
    } catch (e) {
      global.__journal = await journal().innerText().catch(() => '');
      throw e;
    }
  };
  const lastTurnText = () => journal().locator('li').first().innerText();

  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.goto(BASE + '/clients');
  await p.getByLabel('Nom du resto').fill('Cookies An Nou');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByRole('heading', { name: 'Cookies An Nou' }).click();
  await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).click();
  await p.getByText('Lié au Modèle maître').waitFor();
  await p.getByRole('link', { name: '💬 Tester le bot' }).click();
  await p.waitForURL(/\/simulateur\?client=/);
  await p.getByLabel('Délais réels').uncheck();
  await p.waitForFunction(() => !document.querySelector('[aria-label="IA réelle"]').disabled);
  await p.getByLabel('Mode de déclenchement').selectOption('toujours');
  await p.getByLabel('Prénom du client').fill('Pauwels Jules');

  // 4 + 2. Premier « bonjour » : accueil complet, sans prénom deviné.
  await say('bonjour');
  await chat().getByText('👋 Hello ! Bienvenue chez Cookies An Nou', { exact: false }).waitFor();
  if (await chat().getByText('Hello Pauwels', { exact: false }).count()) throw new Error('prénom deviné à tort');
  step('« bonjour » (profil « Pauwels Jules ») : accueil complet, « Hello ! » sans prénom deviné');

  // 2. Deuxième « bonjour » : version courte, pas de nouveau « Bienvenue ».
  await say('Bonjour');
  await chat().getByText('Que puis-je faire pour vous ? 👇').waitFor();
  if ((await chat().getByText('Bienvenue chez', { exact: false }).count()) !== 1) throw new Error('le grand accueil ne doit partir qu\'une fois');
  step('2e « Bonjour » : version courte (« Que puis-je faire pour vous ? » + 3 boutons), pas de 2e bienvenue');

  // Bouton « 🛒 Commander » de la version courte → CTA.
  await chat().getByRole('button', { name: '🛒 Commander' }).last().click();
  await chat().getByText('Ça vous tente ?', { exact: false }).last().waitFor();
  step('bouton « 🛒 Commander » de la version courte → bouton « Je commande »');

  // 2. « je veux commander » → CTA - Commander, pas l'Accueil.
  await say('je veux commander');
  await lastTurnHas('« CTA - Commander »');
  if ((await chat().getByText('Bienvenue chez', { exact: false }).count()) !== 1) throw new Error('« commander » ne doit plus relancer l\'Accueil');
  step('« je veux commander » → flux « CTA - Commander » (pas l\'Accueil)');

  // 1. Vraie question → IA.
  await say("c'est quoi votre meilleur cookie ?");
  await lastTurnHas('répond elle-même');
  const t1 = await lastTurnText();
  if (t1.includes('« Accueil »')) throw new Error('la question ne doit pas relancer l\'Accueil : ' + t1);
  step('« c\'est quoi votre meilleur cookie ? » → l\'IA répond (pas l\'Accueil)');

  // Mot-clé dans une phrase longue → IA (pas le flux Infos pratiques).
  await say('vous faites la livraison à Jarry demain matin ?');
  await lastTurnHas('dans une phrase longue');
  await chat().getByText('Prochaine livraison', { exact: false }).last().waitFor();
  step('« livraison » dans une phrase longue → l\'IA répond (mot-clé ignoré, expliqué dans le journal)');

  // Mot-clé court → flux.
  await say('horaires ?');
  await lastTurnHas('« Infos pratiques »');
  step('« horaires ? » (message court) → flux « Infos pratiques »');

  await p.screenshot({ path: OUT + '/accueil-ia.png' });
  const requests = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const asked = requests.map((r) => { const m = r.params.messages[r.params.messages.length - 1].content; return typeof m === 'string' ? m : m.map((x) => x.text).join(''); });
  if (asked.length !== 2) throw new Error('2 appels IA attendus, ' + asked.length + ' : ' + asked.join(' / '));
  step('2 appels IA seulement (la question et la phrase longue), aucun pour les salutations ni les mots-clés courts');
  if (errors.length) throw new Error('Erreurs : ' + errors.join('\n'));
  await b.close();
})().catch((e) => {
  console.error('✘', e.message);
  if (process.env.DEBUG_JOURNAL) console.error(global.__journal);
  process.exit(1);
});
