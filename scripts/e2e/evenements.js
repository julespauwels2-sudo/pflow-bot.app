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
  const row = (name) => p.locator(`li[data-flow="${name}"]`);
  const back = () => p.getByRole('link', { name: '← Modèle maître' }).click();

  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await folder('Commande').locator('li[data-flow]').first().waitFor();
  await row('Statut - Prête').getByText('Événement : ✅ Commande prête').waitFor();
  await row('Panier abandonné').getByText('Événement : 🛒 Panier abandonné').waitFor();
  step('dossier Commande : 4 flux déclenchés par des événements PFlow Order');

  for (const name of ['Commande - Paiement validé', 'Statut - En préparation', 'Statut - Prête', 'Panier abandonné']) {
    await row(name).getByRole('link', { name, exact: true }).click();
    await p.locator('.react-flow__node').first().waitFor();
    await p.getByText('Aucun problème').waitFor();
    if (name === 'Panier abandonné') {
      const m = p.locator('.react-flow__node[data-id="m"]');
      await m.getByText('🔗 🛒 Reprendre').waitFor();
      await m.getByText('❌ Laisser tomber', { exact: true }).waitFor();
      await p.screenshot({ path: OUT + '/m3c-panier.png' });
    }
    if (name === 'Commande - Paiement validé') await p.screenshot({ path: OUT + '/m3c-paiement.png' });
    await back();
    await folder('Commande').locator('li[data-flow]').first().waitFor();
  }
  step('les 4 flux de commande s\'ouvrent sans erreur ; panier en 2 bulles (lien puis réponse)');

  // Panneau du déclencheur
  await row('Statut - Prête').getByRole('link', { name: 'Statut - Prête', exact: true }).click();
  await p.locator('.react-flow__node-trigger').click({ position: { x: 100, y: 15 } });
  if ((await p.getByLabel('Type de déclencheur').inputValue()) !== 'evenement') throw new Error('type de déclencheur');
  if ((await p.getByLabel('Événement', { exact: true }).inputValue()) !== 'commande_prete') throw new Error('événement');
  await p.getByText('Envoyé seulement si le client a écrit au bot depuis moins de 24 h').waitFor();
  await p.locator('.react-flow__node[data-id="retrait"]').click({ position: { x: 100, y: 15 } });
  await p.getByLabel('Insérer une variable').first().click();
  await p.getByRole('menuitem', { name: /client_nom/ }).waitFor();
  await p.getByRole('menuitem', { name: /commande_numero/ }).waitFor();
  step('déclencheur « Événement PFlow Order » : type, événement, règle des 24 h, variables dans le menu {x}');
  await p.keyboard.press('Escape');
  await back();

  // Un seul flux par événement
  await p.getByPlaceholder('Nom du nouveau flux').fill('Doublon prête');
  await p.getByLabel('Dossier du nouveau flux').selectOption({ label: 'Commande' });
  await p.getByRole('button', { name: 'Créer', exact: true }).click();
  await p.locator('.react-flow__node-trigger').waitFor();
  await p.locator('.react-flow__node-trigger').click({ position: { x: 100, y: 15 } });
  await p.getByLabel('Type de déclencheur').selectOption('evenement');
  await p.getByLabel('Événement', { exact: true }).selectOption('commande_prete');
  await p.getByText("Le flux « Statut - Prête » réagit déjà à l'événement « Commande prête ».").first().waitFor();
  step('un seul flux par événement : erreur bloquante sur le doublon');
  await back();
  await row('Doublon prête').getByRole('button', { name: 'Supprimer Doublon prête' }).click();

  // Compléter un modèle déjà créé
  await row('Statut - Prête').getByRole('button', { name: 'Supprimer Statut - Prête' }).click();
  await p.getByText('La trame PFlow contient 1 flux absent de ton modèle : Statut - Prête.').waitFor();
  await p.getByRole('button', { name: 'Ajouter les flux manquants' }).click();
  await p.getByText('Ajouté et publié : Statut - Prête.').waitFor();
  await row('Statut - Prête').waitFor();
  step('« Ajouter les flux manquants » complète un modèle existant');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
