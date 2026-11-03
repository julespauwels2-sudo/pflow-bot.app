const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✔', s);
  const folder = (name) => p.locator(`details[data-folder="${name}"]`);
  const flowsIn = async (name) => folder(name).locator('li[data-flow]').evaluateAll((els) => els.map((e) => e.dataset.flow));
  const order = () => p.locator('details[data-folder]').evaluateAll((els) => els.map((e) => e.dataset.folder));

  await p.goto(BASE + '/clients');
  await p.getByRole('button', { name: "Charger le resto d'exemple" }).click();
  await p.getByRole('heading', { name: 'Resto Démo' }).click();
  await folder('Principales PFlow Order').waitFor();
  const principales = await flowsIn('Principales PFlow Order');
  if (principales.join() !== 'Accueil,CTA - Commander,Infos pratiques') throw new Error('principales : ' + principales);
  if ((await flowsIn('Fonctions IA')).join() !== 'IA - Recommandation') throw new Error('fonctions IA');
  if (await folder('Sans dossier').count()) throw new Error('« Sans dossier » vide : ne doit pas s\'afficher');
  step('démo rangée : Principales PFlow Order (3 flux), Fonctions IA (1 flux)');

  await p.getByLabel('Nom du nouveau dossier').fill('Commande');
  await p.getByRole('button', { name: '+ Dossier' }).click();
  await folder('Commande').getByText('Dossier vide').waitFor();
  await p.getByLabel('Nom du nouveau dossier').fill('commande');
  await p.getByRole('button', { name: '+ Dossier' }).click();
  await p.getByText('Le dossier « commande » existe déjà').waitFor();
  step('création d\'un dossier ; doublon refusé');

  await p.getByLabel('Déplacer CTA - Commander vers').selectOption({ label: 'Commande' });
  await p.waitForFunction(() => document.querySelector('details[data-folder="Commande"] li[data-flow="CTA - Commander"]'));
  step('flux déplacé vers un autre dossier');

  await folder('Commande').getByRole('button', { name: 'Renommer' }).click();
  await p.getByLabel('Nouveau nom du dossier').fill('Commandes');
  await p.getByRole('button', { name: 'OK' }).click();
  await folder('Commandes').waitFor();
  await p.getByRole('button', { name: 'Monter Commandes' }).click();
  await p.waitForFunction(() => [...document.querySelectorAll('details[data-folder]')].map((e) => e.dataset.folder).join() === 'Principales PFlow Order,Commandes,Fonctions IA');
  step('renommer et réordonner');

  await p.reload();
  await folder('Commandes').waitFor();
  if ((await order()).join() !== 'Principales PFlow Order,Commandes,Fonctions IA') throw new Error('ordre non conservé : ' + (await order()));
  if ((await flowsIn('Commandes')).join() !== 'CTA - Commander') throw new Error('rangement non conservé');
  step('rechargement : dossiers, ordre et rangement conservés');
  await p.screenshot({ path: OUT + '/m3a-dossiers.png', fullPage: true });

  await folder('Commandes').getByRole('button', { name: 'Supprimer' }).first().click();
  await folder('Sans dossier').waitFor();
  if ((await flowsIn('Sans dossier')).join() !== 'CTA - Commander') throw new Error('le flux doit passer dans Sans dossier');
  step('supprimer un dossier : son flux passe dans « Sans dossier », jamais supprimé');

  await p.getByPlaceholder('Nom du nouveau flux').fill('IA - Parler équipe');
  await p.getByLabel('Dossier du nouveau flux').selectOption({ label: 'Fonctions IA' });
  await p.getByRole('button', { name: 'Créer', exact: true }).click();
  await p.waitForURL(/\/flows\//);
  await p.goBack();
  await folder('Fonctions IA').waitFor();
  if (!(await flowsIn('Fonctions IA')).includes('IA - Parler équipe')) throw new Error('nouveau flux pas dans le bon dossier');
  step('nouveau flux créé directement dans un dossier');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
