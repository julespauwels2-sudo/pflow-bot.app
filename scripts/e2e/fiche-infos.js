const { chromium } = require('playwright');
const SP = process.argv[2];
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const step = (s) => console.log('✔', s);

  await p.goto(BASE + '/clients');
  await p.getByRole('button', { name: "Charger le resto d'exemple" }).click();
  await p.getByRole('heading', { name: 'Resto Démo' }).click();
  await p.getByLabel('Moyens de paiement').waitFor();
  if (await p.getByRole('link', { name: 'Agneau du week-end' }).count()) throw new Error('Agneau ne devrait plus être dans la démo');
  await p.getByRole('link', { name: 'CTA - Commander', exact: true }).waitFor();
  step('démo : 4 flux (Accueil, IA - Recommandation, Infos pratiques, CTA - Commander), plus d\'Agneau');

  // Aperçu des variables
  await p.getByText('Aperçu des variables utilisables dans les messages').click();
  const preview = p.locator('details');
  await preview.getByText('Du mardi au jeudi : 11h30 – 14h30').first().waitFor();
  await preview.getByText(/^Aujourd'hui \(/).first().waitFor();
  step('aperçu : {{horaires}} regroupés, {{horaires_du_jour}} au fuseau du client');

  // Planning
  await p.getByText('Sur planning (tournées à des dates précises)').click();
  await p.getByRole('button', { name: '+ Ajouter une tournée' }).click();
  await p.getByLabel('Date de la tournée').nth(0).fill('2026-10-01');
  await p.getByLabel('Zone ou entreprises desservies').nth(0).fill('Jarry — tournée passée');
  await p.getByRole('button', { name: '+ Ajouter une tournée' }).click();
  await p.getByLabel('Date de la tournée').nth(1).fill('2026-12-15');
  await p.getByLabel('Début').nth(1).fill('11:30');
  await p.getByLabel('Fin').nth(1).fill('13:00');
  await p.getByLabel('Zone ou entreprises desservies').nth(1).fill('Jarry — Orange, EDF');
  await p.getByText('passée', { exact: true }).waitFor();
  await preview.getByText('• *Mardi 15 décembre* (11h30 – 13h) : Jarry — Orange, EDF').first().waitFor();
  if (await preview.getByText('tournée passée').count()) throw new Error('la tournée passée ne doit pas apparaître dans les variables');
  step('planning : tournée passée signalée et absente des variables, tournée à venir formatée');
  await p.getByRole('button', { name: /Retirer les 1 tournée passée/ }).click();
  if (await p.getByText('Jarry — tournée passée').count()) throw new Error('tournée passée non retirée');
  await p.getByLabel('Moyens de paiement').fill('Espèces à la livraison');
  await p.getByRole('button', { name: 'Enregistrer' }).last().click();
  await p.getByText("Fiche d'infos enregistrée.").waitFor();
  await p.screenshot({ path: SP + '/m2-fiche.png', fullPage: true });
  await p.reload();
  await p.getByLabel('Zone ou entreprises desservies').first().waitFor();
  if ((await p.getByLabel('Zone ou entreprises desservies').first().inputValue()) !== 'Jarry — Orange, EDF') throw new Error('tournée non sauvegardée');
  if ((await p.getByLabel('Moyens de paiement').inputValue()) !== 'Espèces à la livraison') throw new Error('paiement non sauvegardé');
  step('enregistré et relu après rechargement (planning + paiement)');

  // Éditeur : Infos pratiques sans erreur, menu {x}
  await p.getByRole('link', { name: 'Infos pratiques', exact: true }).click();
  await p.locator('.react-flow__node').first().waitFor();
  await p.getByText('Aucun problème').waitFor();
  await p.locator('.react-flow__node[data-id="h"]').click({ position: { x: 120, y: 12 } });
  await p.getByLabel('Insérer une variable').first().click();
  for (const v of ['horaires_du_jour', 'infos_livraison', 'prochaines_livraisons', 'modes_paiement', 'infos_pratiques']) {
    await p.getByRole('menuitem', { name: new RegExp(v) }).first().waitFor();
  }
  step('éditeur : Infos pratiques sans erreur, nouvelles variables dans le menu {x}');
  await p.keyboard.press('Escape');
  await p.screenshot({ path: SP + '/m2-infos.png' });

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
