/**
 * Nuit du 7 novembre 2026, dans le simulateur (faux serveur Anthropic, voir agent-ia.js) :
 * événements annulée / remboursée / annulation refusée / rappel, suivre_commande et annuler_commande
 * (pont simulé : aucun appel à PFlow Order), recommandation → proposer_commande.
 *
 *   node scripts/e2e/fake-anthropic.js /tmp/requetes-ia.jsonl
 *   npm run build && ANTHROPIC_API_KEY=cle-de-test ANTHROPIC_BASE_URL=http://127.0.0.1:4555 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/commande-c5.js /tmp
 */
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
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
    await p.getByLabel('Message du client').fill(text);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
  };
  let dump = '';
  const lastTurnHas = async (text) => {
    try {
      await journal().locator('li').first().getByText(text, { exact: false }).first().waitFor({ timeout: 6000 });
    } catch (e) {
      dump = await journal().innerText().catch(() => '');
      throw e;
    }
  };
  const event = async (type, data = {}) => {
    await p.getByRole('button', { name: '📦 Événement PFlow Order' }).click();
    await p.getByLabel("Type d'événement").selectOption(type);
    for (const [k, v] of Object.entries(data)) await p.getByTestId('event-form').getByLabel(k, { exact: true }).fill(v);
    await p.getByRole('button', { name: "Envoyer l'événement" }).click();
  };

  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.getByText('suivre_commande', { exact: false }).first().waitFor();
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
  await say('salut');
  await lastTurnHas('« Accueil »');

  // 3. Événements
  await event('commande_annulee', { remboursement: 'total', montant_rembourse: '32 €' });
  await chat().getByText('remboursée intégralement', { exact: false }).last().waitFor();
  await event('commande_annulee', { remboursement: '' });
  await chat().getByText('Votre commande #1042 a été annulée.', { exact: false }).last().waitFor();
  await event('commande_remboursee');
  await chat().getByText('Remboursement effectué', { exact: false }).last().waitFor();
  await event('annulation_refusee');
  await chat().getByText('Annulation impossible', { exact: false }).last().waitFor();
  await event('rappel_commande_prete');
  await chat().getByText('Votre commande vous attend', { exact: false }).last().waitFor();
  step('événements : annulée (remboursée / sans paiement), remboursée, annulation refusée, rappel');

  // 4. C5 : suivi et annulation (pont simulé)
  await say('elle arrive quand ma commande ?');
  await lastTurnHas('fonction suivre_commande');
  await chat().getByText('(Simulation) Votre commande n° 1042 (32 €) est en préparation.', { exact: false }).last().waitFor();
  step('suivre_commande : réponse de PFlow Order (simulée) envoyée');
  await say('je veux annuler ma commande');
  await lastTurnHas('fonction annuler_commande');
  await chat().getByText('Vous voulez vraiment annuler', { exact: false }).last().waitFor();
  if (await chat().getByText('est annulée. Vous êtes remboursé', { exact: false }).count()) throw new Error('annulée sans confirmation');
  await chat().getByRole('button', { name: '↩️ Non, la garder' }).last().click();
  await chat().getByText("C'est noté, votre commande continue", { exact: false }).last().waitFor();
  await say('finalement je veux annuler');
  await chat().getByRole('button', { name: '✅ Oui, annuler' }).last().click();
  await chat().getByText('(Simulation) Votre commande n° 1042 est annulée.', { exact: false }).last().waitFor();
  await lastTurnHas('PFlow Order : annulation de la commande');
  step('annuler_commande : confirmation, « Non » garde la commande, « Oui » annule (simulé)');

  // 5. Recommandation → proposer_commande
  await say('vous avez quoi au chocolat ?');
  await lastTurnHas('fonction proposer_commande');
  await chat().getByText('est fait pour vous', { exact: false }).last().waitFor();
  await chat().getByRole('link', { name: '🔗 😋 Je commande' }).last().waitFor();
  step('recommandation → proposer_commande : réponse de l\'IA puis bouton « Je commande »');

  await p.screenshot({ path: OUT + '/commande-c5.png' });
  if (errors.length) throw new Error('Erreurs : ' + errors.join('\n'));
  await b.close();
})().catch((e) => {
  console.error('✘', e.message.split('\n').slice(0, 4).join('\n'));
  if (dump) console.error(dump.slice(0, 1500));
  process.exit(1);
});
