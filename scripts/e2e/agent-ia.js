/**
 * Agent IA de bout en bout, avec le faux serveur Anthropic (voir fake-anthropic.js) :
 * page Agent IA, fiche (carte, FAQ), « Ce que l'IA sait », simulateur avec IA réelle,
 * fonctions, journal des appels et coût, bloc IA dans l'éditeur.
 */
const fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const LOG = process.argv[3] || '/tmp/requetes-ia.jsonl';
const BASE = 'http://localhost:3123';
let page;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  page = p;
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined));
  const step = (s) => console.log('✔', s);
  const chat = () => p.locator('[data-testid="chat"]');
  const journal = () => p.locator('[data-testid="journal"]');
  const say = async (text) => {
    await p.getByLabel('Message du client').fill(text);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
  };
  const lastTurnHas = (text) => journal().locator('li').first().getByText(text, { exact: false }).first().waitFor();

  // Modèle maître + page Agent IA
  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.getByText('lancer_commande, proposer_commande, parler_equipe').waitFor();
  await p.getByRole('link', { name: "Configurer l'agent IA" }).click();
  await p.getByText('Clé API Anthropic configurée sur le serveur').waitFor();
  if ((await p.getByTestId('agent-function').count()) !== 3) throw new Error('3 fonctions attendues');
  if (!(await p.getByLabel('Consigne générale').inputValue()).includes("Tu es l'assistant WhatsApp officiel de {{nom_resto}}.")) throw new Error('consigne');
  await p.getByLabel('Appels IA par contact et par jour').fill('15');
  await p.getByRole('button', { name: 'Enregistrer' }).click();
  await p.getByText("Agent IA enregistré").waitFor();
  // Erreur bloquante : nom de fonction invalide
  await p.getByLabel('Nom de la fonction').first().fill('Lancer Commande');
  await p.getByTestId('agent-issues').getByText('minuscules, chiffres et _').waitFor();
  if (await p.getByRole('button', { name: 'Enregistrer' }).isEnabled()) throw new Error('enregistrement devrait être bloqué');
  await p.reload();
  if ((await p.getByLabel('Appels IA par contact et par jour').inputValue()) !== '15') throw new Error('limite non enregistrée');
  await p.screenshot({ path: OUT + '/a6-agent.png', fullPage: true });
  step('page Agent IA : clé détectée, consigne et 3 fonctions par défaut, réglages enregistrés, nom invalide bloqué');

  // Client lié + fiche d'infos (carte, FAQ)
  await p.goto(BASE + '/clients');
  await p.getByLabel('Nom du resto').fill('Cookies An Nou');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByRole('heading', { name: 'Cookies An Nou' }).click();
  await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).click();
  await p.getByText('Lié au Modèle maître').waitFor();
  const kb = p.getByTestId('ai-knowledge');
  await kb.getByText('À compléter dans la fiche').waitFor();
  await p.getByLabel("Carte (pour l'IA)").fill('== Cookies ==\n• Tout choco : 4 €\nAllergènes : Gluten, Œufs, Lait');
  await p.getByLabel("Questions fréquentes (pour l'IA)").fill('Vous faites des box ? Oui : 6, 10 ou 15 cookies.');
  await p.getByRole('button', { name: 'Enregistrer' }).last().click();
  await p.getByText("Fiche d'infos enregistrée.").waitFor();
  await kb.getByText('• Tout choco : 4 €').waitFor();
  await kb.getByText('Vous faites des box ?').waitFor();
  for (const f of ['lancer_commande', 'proposer_commande', 'parler_equipe']) await kb.getByText(f, { exact: true }).waitFor();
  await kb.getByText('Consigne de l\'agent, pour ce resto').click();
  await kb.getByText("Tu es l'assistant WhatsApp officiel de Cookies An Nou.").waitFor();
  step('« Ce que l\'IA sait de ce resto » : carte, FAQ, fonctions et consigne rendue pour ce client');

  // Simulateur avec IA réelle (faux serveur)
  await p.getByRole('link', { name: '💬 Tester le bot' }).click();
  await p.waitForURL(/\/simulateur\?client=/);
  await p.getByLabel('Délais réels').uncheck();
  const realAi = p.getByLabel('IA réelle');
  await p.waitForFunction(() => !document.querySelector('[aria-label="IA réelle"]').disabled);
  if (!(await realAi.isChecked())) throw new Error('IA réelle devrait être cochée');

  await p.getByLabel('Lancer un flux').selectOption({ label: 'IA - Recommandation' });
  await chat().getByText("⭐ Je vous aide à choisir !", { exact: false }).waitFor();
  await say('plutôt du chocolat');
  await chat().getByText('est fait pour vous', { exact: false }).waitFor();
  await chat().getByRole('link', { name: '🔗 😋 Je commande' }).last().waitFor();
  await lastTurnHas('IA (Claude Haiku 5.5) : fonction proposer_commande');
  await journal().locator('li').first().getByText(/2.750 tokens lus dont 2.400 en cache/).waitFor();
  step('bloc IA : réponse de l\'IA passée au flux proposer_commande ({{ia_reponse}}), puis bouton Je commande');

  await p.getByLabel('Mode de déclenchement').selectOption('toujours');
  await say('salut');
  await lastTurnHas('« Accueil »');
  // Texte libre pendant que l'Accueil attend un clic : l'IA répond, puis les boutons reviennent.
  await say('vous livrez quand ?');
  await chat().getByText('Prochaine livraison', { exact: false }).waitFor();
  await lastTurnHas('répond elle-même');
  await say("j'ai faim");
  await lastTurnHas('fonction lancer_commande');
  await chat().getByText('Vous pouvez composer votre commande', { exact: false }).last().waitFor();
  await p.getByTestId('ai-spent').waitFor();
  await p.screenshot({ path: OUT + '/a6-simulateur.png' });
  step('flux par défaut d\'abord, puis IA sur le texte libre : réponse directe, lancer_commande (l\'IA se tait), coût cumulé');

  // Garde-fou : l'IA écrit un lien malgré les règles → lien retiré, proposer_commande (bouton garanti).
  await say('salut');
  await say('je peux voir la carte ?');
  await lastTurnHas('Garde-fou IA : lien retiré');
  await lastTurnHas('enchaîne sur proposer_commande');
  await chat().getByText('Toute notre carte est ici', { exact: true }).waitFor();
  if (await chat().getByText('https://order.pflow.fr', { exact: false }).count()) throw new Error('le lien ne doit pas apparaître dans le texte');
  await chat().getByText('Ça vous tente ?', { exact: false }).last().waitFor();
  step('garde-fou : lien et « Bonjour » retirés de la réponse de l\'IA, bouton via proposer_commande');

  await say('salut');
  await say('je veux parler à une personne');
  await lastTurnHas('fonction parler_equipe');
  await lastTurnHas('Transfert humain');
  step('parler_equipe : transfert humain et pause du bot');

  // Journal des appels et coût sur la page client
  await p.getByRole('link', { name: '← Cookies An Nou' }).click();
  const calls = p.getByTestId('ai-calls');
  await calls.getByText('5 appels', { exact: false }).first().waitFor();
  await calls.getByText('proposer_commande').waitFor();
  await calls.getByText('plutôt du chocolat').waitFor();
  await p.screenshot({ path: OUT + '/a6-client.png', fullPage: true });
  step('journal des appels IA : 5 appels, décisions, tokens et coût');

  // Ce qu'a reçu l'API : cache, sorties structurées, pas de réflexion, clé côté serveur
  const requests = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  if (requests.length !== 5) throw new Error(`5 requêtes attendues, ${requests.length} reçues`);
  const first = requests[0].params;
  if (first.model !== 'claude-haiku-5-5') throw new Error('modèle');
  if (JSON.stringify(first.thinking) !== '{"type":"disabled"}') throw new Error('thinking');
  if (first.output_config?.format?.type !== 'json_schema') throw new Error('sorties structurées');
  if (!first.system[2].cache_control || first.system[3].cache_control) throw new Error('point de cache');
  if (!first.system[2].text.includes('Tout choco')) throw new Error('carte absente de la base');
  if (!first.system[3].text.includes('proposer_commande')) throw new Error('fonctions absentes du contexte');
  if ('temperature' in first) throw new Error('temperature ne doit pas être envoyée');
  if (requests[0].apiKey !== 'cle-de-test') throw new Error('clé API');
  step('requêtes à l\'API : Haiku 5.5, sans réflexion, sortie JSON, base de connaissances en cache');

  // Éditeur : bloc IA
  await p.goto(BASE + '/modele');
  await p.getByRole('link', { name: 'IA - Recommandation' }).click();
  await p.locator('.react-flow__node').filter({ hasText: 'Agent IA' }).first().click();
  await p.getByText('Fonctions autorisées').waitFor();
  await p.getByText('Texte d\'entrée', { exact: true }).waitFor();
  await p.locator('label').filter({ hasText: 'parler_equipe' }).locator('input').uncheck();
  await p.locator('.react-flow__node').getByText('Fonctions : lancer_commande, proposer_commande').waitFor();
  await p.getByLabel('Délai d\'inactivité').fill('5');
  await p.screenshot({ path: OUT + '/a6-bloc-ia.png' });
  step('éditeur : bloc IA avec texte d\'entrée, fonctions autorisées et délai d\'inactivité');

  const real = errors.filter((e) => !e.includes('Download the React DevTools'));
  if (real.length) throw new Error('Erreurs console :\n' + real.join('\n'));
  console.log('Aucune erreur dans la console.');
  await b.close();
})().catch(async (e) => {
  console.error('✘', e.message);
  if (page) {
    await page.screenshot({ path: OUT + '/a6-echec.png' }).catch(() => {});
    console.error(await page.locator('[data-testid="chat"]').innerText().catch(() => ''));
  }
  process.exit(1);
});
