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
  const botRow = (name) => p.locator(`li[data-bot-flow="${name}"]`);
  const checklist = () => p.locator('[data-testid="checklist"]').innerText();

  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.locator('details[data-folder="Commande"]').waitFor();

  await p.getByRole('link', { name: 'Clients' }).click();
  await p.getByLabel('Nom du resto').fill('Cookies An Nou');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByRole('heading', { name: 'Cookies An Nou' }).click();
  await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).click();
  await p.getByText('Lié au Modèle maître').waitFor();
  await botRow('Accueil').waitFor();
  if ((await p.locator('li[data-bot-flow]').count()) !== 11) throw new Error('11 flux du modèle attendus');
  if ((await p.locator('li[data-flow]').count()) !== 0) throw new Error('rien ne doit être copié chez le client');
  const botFolders = await p.locator('[data-bot-folder]').evaluateAll((els) => els.map((e) => e.dataset.botFolder));
  if (botFolders.join() !== 'Principales PFlow Order,Fonctions IA,Commande') throw new Error('ordre des dossiers du modèle : ' + botFolders);
  let text = await checklist();
  for (const expected of ['le flux par défaut « Accueil » ne se lance pas', '{{horaires}} est vide', '« Panier abandonné » est inactif']) {
    if (!text.includes(expected)) throw new Error('liste de contrôle sans : ' + expected + '\n' + text);
  }
  await botRow('Panier abandonné').getByText('Inactif').waitFor();
  step('bot créé depuis le modèle : 11 flux du modèle, rien copié, liste de contrôle d\'onboarding');
  await p.screenshot({ path: OUT + '/m3d-bot.png', fullPage: true });

  // Option payante
  await p.getByText('Relance panier abandonné', { exact: true }).click();
  await p.getByRole('button', { name: 'Enregistrer' }).first().click();
  await p.waitForFunction(() => !document.querySelector('li[data-bot-flow="Panier abandonné"]')?.innerText.includes('Inactif'));
  if ((await checklist()).includes('Panier abandonné')) throw new Error('option activée : plus d\'alerte panier');
  step('option « Relance panier abandonné » activée : le flux devient actif');

  // Personnaliser
  await botRow('IA - Recommandation').getByRole('button', { name: 'Personnaliser' }).click();
  await p.waitForURL(/\/flows\//);
  await p.getByText('Personnalisé', { exact: true }).waitFor();
  await p.getByText('Aucun problème').waitFor();
  await p.getByRole('link', { name: '← Cookies An Nou' }).click();
  await botRow('IA - Recommandation').getByText('Personnalisé', { exact: true }).waitFor();
  await p.locator('details[data-folder="Fonctions IA"] li[data-flow="IA - Recommandation"]').getByText(/Personnalisé · remplace « IA - Recommandation » du modèle/).waitFor();
  step('« Personnaliser » : copie chez ce client (dossier Fonctions IA), badge dans l\'éditeur et sur la page client');

  // Le modèle change ensuite
  await p.getByRole('link', { name: 'Modèle maître' }).click();
  await p.getByRole('link', { name: 'IA - Recommandation', exact: true }).click();
  await p.getByLabel('Description du flux').fill('Nouvelle version du modèle');
  await p.locator('.react-flow__pane').click({ position: { x: 15, y: 15 } });
  await p.getByRole('button', { name: 'Publier', exact: true }).click();
  await p.getByText('v2 publiée', { exact: true }).waitFor();
  await p.getByRole('link', { name: '← Modèle maître' }).click();
  await p.getByRole('link', { name: 'Clients' }).click();
  await p.getByRole('heading', { name: 'Cookies An Nou' }).click();
  await botRow('IA - Recommandation').getByText('Modèle mis à jour depuis').waitFor();
  if (!(await checklist()).includes('Le modèle a changé depuis la personnalisation de « IA - Recommandation »')) throw new Error('alerte modèle modifié');
  step('le modèle republie le flux : la personnalisation n\'est pas écrasée, une alerte le signale');

  // Revenir au modèle
  await botRow('IA - Recommandation').getByRole('button', { name: 'Revenir au modèle' }).click();
  await botRow('IA - Recommandation').getByText('Modèle', { exact: true }).waitFor();
  if (await p.locator('li[data-flow="IA - Recommandation"]').count()) throw new Error('la copie doit être supprimée');
  step('« Revenir au modèle » : copie supprimée, le flux du modèle reprend');

  // Détacher
  await p.getByRole('button', { name: 'Détacher du modèle' }).click();
  await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).waitFor();
  await p.locator('details[data-folder="Commande"]').waitFor();
  if ((await p.locator('li[data-flow]').count()) !== 11) throw new Error('11 flux copiés attendus après détachement');
  step('« Détacher » : les 11 flux sont copiés chez le client, rangés dans les mêmes dossiers, lien coupé');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
