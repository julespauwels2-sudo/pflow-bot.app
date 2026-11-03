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
  const flowsIn = (name) => folder(name).locator('li[data-flow]').evaluateAll((els) => els.map((e) => e.dataset.flow));

  await p.goto(BASE + '/clients');
  await p.getByRole('link', { name: 'Modèle maître' }).click();
  await p.getByText('Pas encore de modèle maître').waitFor();
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await folder('Principales PFlow Order').waitFor();
  const order = await p.locator('details[data-folder]').evaluateAll((els) => els.map((e) => e.dataset.folder));
  if (order.join() !== 'Principales PFlow Order,Fonctions IA,Commande') throw new Error('ordre des dossiers : ' + order);
  if ((await flowsIn('Principales PFlow Order')).join() !== 'Accueil,CTA - Commander,Infos pratiques') throw new Error('principales');
  if ((await flowsIn('Fonctions IA')).length !== 4) throw new Error('fonctions IA');
  if ((await flowsIn('Commande')).length !== 4) throw new Error('4 flux de commande attendus');
  if ((await p.getByText('Publié v1').count()) !== 11) throw new Error('11 flux publiés attendus');
  step('modèle créé depuis la trame : 3 dossiers dans l\'ordre, 11 flux publiés');
  await p.screenshot({ path: OUT + '/m3b-modele.png', fullPage: true });

  await p.getByRole('link', { name: 'Accueil', exact: true }).click();
  await p.locator('.react-flow__node').first().waitFor();
  await p.getByText('Flux du modèle', { exact: true }).waitFor();
  await p.getByRole('link', { name: '← Modèle maître' }).waitFor();
  await p.getByText('Aucun problème').waitFor();
  await p.locator('.react-flow__node[data-id="m"]').getByText('https://order.pflow.fr/c/<slug du client>').waitFor();
  step('éditeur du modèle : badge, retour au modèle, aucune erreur, lien de commande générique');
  await p.screenshot({ path: OUT + '/m3b-accueil.png' });

  await p.locator('.react-flow__node[data-id="m"]').click({ position: { x: 120, y: 12 } });
  await p.getByLabel('Texte de la bulle 1').fill('👋 Coucou {{prenom}} ! Bienvenue chez {{nom_resto}} 🍔');
  await p.getByLabel('Insérer une variable').first().click();
  await p.getByRole('menuitem', { name: /ia_reponse/ }).waitFor();
  await p.keyboard.press('Escape');
  await p.locator('.react-flow__pane').click({ position: { x: 15, y: 15 } });
  await p.getByRole('button', { name: 'Publier', exact: true }).click();
  await p.getByText('v2 publiée', { exact: true }).waitFor();
  step('modification publiée (v2) ; {{ia_reponse}} dans le menu des variables');

  await p.getByRole('link', { name: '← Modèle maître' }).click();
  await folder('Principales PFlow Order').getByText('Publié v2').waitFor();
  await p.getByPlaceholder('Nom du nouveau flux').fill('Mon flux test');
  await p.getByLabel('Dossier du nouveau flux').selectOption({ label: 'Commande' });
  await p.getByRole('button', { name: 'Créer', exact: true }).click();
  await p.waitForURL(/\/flows\//);
  await p.getByRole('link', { name: '← Modèle maître' }).click();
  await folder('Commande').locator('li[data-flow="Mon flux test"]').waitFor();
  if (!(await flowsIn('Commande')).includes('Mon flux test')) throw new Error('flux non créé dans Commande');
  step('nouveau flux créé dans le dossier « Commande » du modèle');

  // Les clients ne voient pas les dossiers du modèle (branchement en M3d).
  await p.getByRole('link', { name: 'Clients' }).click();
  await p.getByRole('button', { name: "Charger le resto d'exemple" }).click();
  await p.getByRole('heading', { name: 'Resto Démo' }).click();
  await folder('Principales PFlow Order').waitFor();
  if (await folder('Commande').count()) throw new Error('le dossier Commande du modèle ne doit pas apparaître chez le client');
  step('page client inchangée (dossiers du client seulement)');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
