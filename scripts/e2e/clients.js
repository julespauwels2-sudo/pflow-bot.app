const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const auth = { httpCredentials: { username: 'x', password: 'test123' } };
  const ctx = await b.newContext({ ...auth, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept(globalThis.promptAnswer || ''); else await d.accept(); });
  const step = (s) => console.log('✔', s);

  await p.goto(BASE + '/clients');
  await p.getByText('Aucun client pour l').waitFor(); step('liste vide');
  await p.getByRole('button', { name: "Charger le resto d'exemple" }).click();
  await p.getByRole('heading', { name: 'Resto Démo' }).waitFor(); step('démo chargée');

  // Création d'un client Martinique
  await p.getByLabel('Nom du resto').fill('Chez Paul Martinique');
  const slug = await p.getByLabel('Slug du mini-site').inputValue(); if (slug !== 'chez-paul-martinique') throw new Error('slug auto: ' + slug);
  await p.getByLabel('Fuseau horaire').selectOption('America/Martinique');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByText('Client « Chez Paul Martinique » créé.').waitFor(); step('client créé, slug auto');
  // Doublon de slug
  await p.getByLabel('Nom du resto').fill('Doublon');
  await p.getByLabel('Slug du mini-site').fill('resto-demo');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByText('est déjà utilisé').waitFor(); step('doublon refusé');
  await p.screenshot({ path: SP + '/a3-clients.png', fullPage: true });

  // Page client démo
  await p.getByRole('link', { name: /Resto Démo/ }).click();
  await p.getByRole('heading', { name: 'Fiche d\'infos' }).waitFor();
  await p.getByText('Publié v1').first().waitFor(); step('page client + flux publiés');
  // Fiche : ajouter plage lundi, modifier adresse, enregistrer, recharger
  await p.locator('li', { hasText: 'lundi' }).getByRole('button', { name: '+ plage' }).click();
  await p.getByLabel('Adresse').fill('1 place de la Victoire, Pointe-à-Pitre');
  await p.getByRole('button', { name: 'Enregistrer' }).last().click();
  await p.getByText("Fiche d'infos enregistrée.").waitFor();
  await p.reload();
  await p.getByLabel('Adresse').waitFor();
  if ((await p.getByLabel('Adresse').inputValue()) !== '1 place de la Victoire, Pointe-à-Pitre') throw new Error('adresse non persistée');
  if ((await p.getByLabel('lundi ouverture').inputValue()) !== '11:30') throw new Error('plage lundi non persistée');
  step('fiche d\'infos persistée après rechargement');
  await p.screenshot({ path: SP + '/a3-client.png', fullPage: true });

  // Export d'un flux puis import
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('li', { hasText: 'CTA - Commander' }).getByRole('button', { name: 'Exporter' }).click()]);
  const flowFile = SP + '/' + dl.suggestedFilename(); await dl.saveAs(flowFile);
  const exported = JSON.parse(fs.readFileSync(flowFile, 'utf8'));
  if (exported.format !== 'pflow-bots/flow') throw new Error('format export');
  step('export flux : ' + dl.suggestedFilename());
  await p.locator('input[type=file]').setInputFiles(flowFile);
  await p.getByText('importé en brouillon').waitFor();
  if ((await p.getByText('Jamais publié').count()) !== 1) throw new Error('import pas en brouillon');
  step('import flux → brouillon');
  // Fichier invalide
  fs.writeFileSync(SP + '/bad.json', '{"format":"pflow-bots/flow","version":1}');
  await p.locator('input[type=file]').setInputFiles(SP + '/bad.json');
  await p.getByText('Fichier de flux invalide').waitFor(); step('fichier invalide refusé');

  // Nouveau flux → ouverture de l'éditeur
  await p.getByPlaceholder('Nom du nouveau flux').fill('Livraison');
  await p.getByRole('button', { name: 'Créer', exact: true }).click();
  await p.waitForURL(/\/flows\//);
  await p.locator('.react-flow__node').first().waitFor();
  if ((await p.getByLabel('Nom du flux').inputValue()) !== 'Livraison') throw new Error('nom du flux');
  step('création d’un flux → éditeur ouvert');

  // Sauvegarde complète puis restauration dans un navigateur vierge
  await p.goto(BASE + '/clients');
  const [bk] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exporter la sauvegarde' }).click()]);
  const bkFile = SP + '/' + bk.suggestedFilename(); await bk.saveAs(bkFile);
  const ctx2 = await b.newContext(auth); const p2 = await ctx2.newPage();
  p2.on('dialog', (d) => d.accept());
  p2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
  await p2.goto(BASE + '/clients');
  await p2.getByText('Aucun client pour l').waitFor();
  await p2.locator('input[type=file]').setInputFiles(bkFile);
  await p2.getByText('Sauvegarde restaurée.').waitFor();
  await p2.getByRole('heading', { name: 'Chez Paul Martinique' }).waitFor(); step('sauvegarde restaurée dans un navigateur vierge');

  // Mobile
  const m = await b.newContext({ ...auth, viewport: { width: 390, height: 844 } }); const pm = await m.newPage();
  await pm.goto(BASE + '/clients'); await pm.getByText('Aucun client').waitFor();
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('débordement horizontal mobile :', overflow);
  await pm.screenshot({ path: SP + '/a3-mobile.png', fullPage: true });

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message); process.exit(1); });
