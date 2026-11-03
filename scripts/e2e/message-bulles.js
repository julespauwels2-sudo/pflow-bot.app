const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✔', s);
  const node = (id) => p.locator(`.react-flow__node[data-id="${id}"]`);
  const pane = () => p.locator('.react-flow__pane').click({ position: { x: 15, y: 15 } });

  await p.goto(BASE + '/clients');
  await p.getByRole('button', { name: "Charger le resto d'exemple" }).click();
  await p.getByRole('heading', { name: 'Resto Démo' }).click();
  for (const name of ['Accueil', 'IA - Recommandation', 'Infos pratiques', 'CTA - Commander']) await p.getByRole('link', { name, exact: true }).waitFor();
  await p.getByRole('link', { name: 'Accueil', exact: true }).click();
  await node('m').waitFor();
  const m = node('m');
  for (const t of ['Bulle 1', 'Bulle 2', '🔗 Commander', 'https://order.pflow.fr/c/resto-demo', '⭐ Me conseiller', 'ℹ️ Infos pratiques', 'Étape suivante']) {
    await m.getByText(t, { exact: true }).waitFor();
  }
  await p.getByText('Aucun problème').waitFor();
  if ((await m.locator('.react-flow__handle.source').count()) !== 3) throw new Error('3 sorties attendues (2 réponses + étape suivante)');
  step('trame d\'accueil : 2 bulles, bouton lien natif + 2 boutons de réponse, « Étape suivante », aucune erreur');
  await p.screenshot({ path: SP + '/m1-accueil.png' });

  // Panneau : boutons grisés selon les règles WhatsApp
  await m.click({ position: { x: 120, y: 12 } });
  const replyBtns = p.getByRole('button', { name: '+ Bouton de réponse' });
  const linkBtns = p.getByRole('button', { name: '+ Bouton lien' });
  if (!(await replyBtns.nth(0).isDisabled())) throw new Error('bulle 1 (lien) : réponse devrait être grisé');
  if (!(await linkBtns.nth(0).isDisabled())) throw new Error('bulle 1 : 2e lien devrait être grisé');
  if (!(await linkBtns.nth(1).isDisabled())) throw new Error('bulle 2 (réponses) : lien devrait être grisé');
  if (await replyBtns.nth(1).isDisabled()) throw new Error('bulle 2 : 3e réponse devrait être possible');
  await p.getByText('Cette bulle a déjà un bouton lien : WhatsApp ne mélange pas les deux.').waitFor();
  step('panneau : mélange impossible (choix grisés + explication)');

  // Menu sur le bloc
  const menus = m.getByRole('button', { name: '+ Ajouter un bouton' });
  if ((await menus.count()) !== 1) throw new Error('bulle 1 (lien) : aucun ajout possible, menu masqué');
  await menus.nth(0).click();
  const linkItem = m.getByRole('menuitem', { name: /Bouton lien/ });
  if (!(await linkItem.isDisabled())) throw new Error('menu : bouton lien devrait être grisé');
  await m.getByRole('menuitem', { name: /Bouton de réponse/ }).click();
  await m.getByText('Option 3', { exact: true }).waitFor();
  await m.getByText('Bouton « Option 3 » non relié.').waitFor();
  if ((await m.getByRole('button', { name: '+ Ajouter un bouton' }).count()) !== 0) {
    throw new Error('plus aucun bouton ajoutable (bulle 1 : lien, bulle 2 : 3 réponses)');
  }
  step('menu sur le bloc : bouton de réponse ajouté, erreur « non relié », plus d\'ajout possible');
  await pane();
  await p.keyboard.press('Control+z');
  await p.waitForFunction(() => !document.body.innerText.includes('Option 3'));
  step('Ctrl+Z annule l\'ajout');

  // Nouvelle bulle avec bouton lien libre
  await m.click({ position: { x: 120, y: 12 } });
  await p.getByRole('button', { name: '+ Ajouter une bulle' }).last().click();
  await m.getByText('Bulle 3 : bulle vide.').waitFor();
  await p.getByLabel('Texte de la bulle 3').fill('⭐ Laissez-nous un avis Google !');
  await linkBtns.nth(2).click();
  await p.getByText('Lien de commande du client').last().click(); // décoche → URL libre
  await p.getByLabel('URL du bouton lien').fill('http://g.page/demo');
  await m.getByText(/l'URL doit commencer par https:\/\//).waitFor();
  await p.getByLabel('URL du bouton lien').fill('https://g.page/demo');
  await p.getByLabel('Titre du bouton lien').last().fill('Donner mon avis');
  await p.waitForFunction(() => !document.body.innerText.includes("l'URL doit commencer"));
  await m.getByText('🔗 Donner mon avis').waitFor();
  step('3e bulle + bouton lien à URL libre (https exigé)');

  // Publier
  await pane();
  await p.getByRole('button', { name: 'Publier', exact: true }).click();
  await p.getByText('v2 publiée', { exact: true }).waitFor();
  step('publication v2');

  // Sauvegarde auto
  await p.reload();
  await node('m').getByText('🔗 Donner mon avis').waitFor();
  step('rechargement : brouillon conservé');

  // Import d'un flux à l'ancien format
  const legacy = {
    format: 'pflow-bots/flow', version: 1, exportedAt: '2026-11-01T00:00:00Z',
    flow: { name: 'Ancien flux', graph: {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { keywords: ['ancien'] } },
        { id: 'b', type: 'buttons', position: { x: 320, y: 0 }, data: { text: 'Choisissez', buttons: [{ id: 'x', title: 'Commander' }] } },
        { id: 'l', type: 'order_link', position: { x: 640, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'b' }, { id: 'e2', source: 'b', sourceHandle: 'x', target: 'l' }],
    } },
  };
  fs.writeFileSync(SP + '/ancien.json', JSON.stringify(legacy));
  await p.getByRole('link', { name: /Resto Démo/ }).click();
  await p.locator('input[type=file]').setInputFiles(SP + '/ancien.json');
  await p.getByText('importé en brouillon').waitFor();
  await p.getByRole('link', { name: 'Ancien flux', exact: true }).click();
  await node('l').getByText('🔗 Commander').waitFor();
  await node('b').getByText('Commander', { exact: true }).waitFor();
  await p.getByText('Aucun problème').waitFor();
  step('ancien flux (Boutons + Lien de commande) importé et converti en bulles, sans erreur');

  // Copier / coller / dupliquer / tout sélectionner sur le bloc à bulles
  await p.getByRole('link', { name: /Resto Démo/ }).click();
  await p.getByRole('link', { name: 'Accueil', exact: true }).click();
  await node('m').waitFor();
  const c0 = await p.locator('.react-flow__node').count();
  await node('m').click({ position: { x: 120, y: 12 } });
  await p.keyboard.press('Control+c');
  await p.keyboard.press('Control+v');
  await p.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n + 1, c0);
  await p.keyboard.press('Control+d');
  await p.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n + 2, c0);
  await p.keyboard.press('Control+a');
  await p.getByText((c0 + 2) + ' blocs sélectionnés').waitFor();
  await p.keyboard.press('Delete');
  await p.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 1);
  await p.keyboard.press('Control+z');
  await p.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n + 2, c0);
  step('copier-coller, dupliquer, Ctrl+A, Suppr puis Ctrl+Z sur le bloc à bulles');

  const palette = await p.locator('aside').first().innerText();
  if (palette.includes('Lien de commande')) throw new Error('le bloc Lien de commande devrait avoir disparu de la palette');
  step('bloc « Lien de commande » retiré de la palette');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
