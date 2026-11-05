/**
 * Démos sur le numéro PFlow, dans un vrai navigateur (mode local) : page Démos (démarrer, mot-clé
 * unique, prolonger, supprimer) et simulateur du numéro PFlow (bot PFlow, mots-clés, session,
 * démo expirée).
 *   npm run build && BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/demos.js /tmp
 */
const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✔', s);

  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.locator('details[data-folder="Commande"]').waitFor();
  for (const nom of ['Byron', 'Mexico']) {
    await p.goto(BASE + '/clients');
    await p.getByLabel('Nom du resto').fill(nom);
    await p.getByRole('button', { name: 'Créer le client' }).click();
    await p.getByRole('heading', { name: nom }).click();
    await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).click();
    await p.getByText('Lié au Modèle maître').waitFor();
  }
  step('modèle maître + 2 restos avec leur bot');

  await p.goto(BASE + '/demos');
  for (const nom of ['Byron', 'Mexico']) {
    await p.locator('li', { hasText: nom }).getByRole('button', { name: 'Démarrer la démo' }).click();
    await p.getByText(`Démo de ${nom} démarrée`).waitFor();
  }
  const rows = p.getByTestId('demo-row');
  if ((await rows.count()) !== 2) throw new Error('2 démos en cours attendues');
  await p.getByText('Pas de bouton Commander', { exact: false }).first().waitFor();
  step('démos démarrées (mot-clé = nom, 5 jours) ; sans code de démo du CRM, pas de bouton Commander signalé');

  const mexicoKw = p.getByLabel('Mot-clé de Mexico');
  await mexicoKw.fill('BYRÔN');
  await rows.filter({ hasText: 'Mexico' }).getByRole('button', { name: 'Enregistrer' }).click();
  await p.getByText('déjà pris par Byron').waitFor();
  await mexicoKw.fill('Mexico Grill');
  await rows.filter({ hasText: 'Mexico' }).getByRole('button', { name: 'Enregistrer' }).click();
  await p.getByText('Mot-clé de Mexico : « Mexico Grill »').waitFor();
  step('mot-clé unique (BYRÔN refusé : déjà pris par Byron), puis « Mexico Grill » enregistré');

  await rows.filter({ hasText: 'Byron' }).getByRole('button', { name: 'Prolonger de 5 jours' }).click();
  await p.getByText('Démo de Byron prolongée').waitFor();
  await rows.filter({ hasText: 'Byron' }).getByText('(10 j)').waitFor();
  step('« Prolonger » : la démo de Byron passe à 10 jours');
  await p.screenshot({ path: OUT + '/demos-page.png', fullPage: true });

  await p.getByTestId('demos-simuler').click();
  const chat = p.getByTestId('chat');
  const say = async (t) => {
    await p.getByPlaceholder(/Écrire|message/i).fill(t);
    await p.keyboard.press('Enter');
  };
  await say('bonjour');
  await chat.getByText('Ici PFlow', { exact: false }).waitFor();
  step('« bonjour » → bot PFlow de base');
  await say('BYRON');
  await chat.getByText('Bienvenue chez Byron', { exact: false }).waitFor();
  await p.getByText('Démo : Byron').waitFor();
  await chat.getByRole('button', { name: 'ℹ️ Infos pratiques' }).last().click();
  await chat.getByText('Que souhaitez-vous savoir', { exact: false }).waitFor();
  step('« BYRON » → la démo de Byron démarre ; un bouton reste dans la démo');
  await say('Mexico Grill');
  await chat.getByText('Bienvenue chez Mexico', { exact: false }).waitFor();
  await p.getByText('Démo : Mexico').waitFor();
  step('autre mot-clé → démo de Mexico');
  await p.getByRole('button', { name: /^\+31 min/ }).click();
  await say('bonjour');
  await p.getByText('Bot PFlow de base', { exact: true }).waitFor();
  step('après la session (31 min sans message) → retour au bot PFlow');
  await p.getByRole('button', { name: '+6 jours' }).click();
  await say('Mexico Grill');
  await chat.getByText('La démo de', { exact: false }).last().waitFor();
  if (!(await chat.innerText()).includes('est terminée')) throw new Error('message de démo terminée attendu');
  await say('Byron');
  await chat.getByText('Bienvenue chez Byron', { exact: false }).nth(1).waitFor();
  step('6 jours plus tard : Mexico (5 j) terminée → message poli ; Byron (10 j) toujours là');
  await p.screenshot({ path: OUT + '/demos-simulateur.png', fullPage: true });

  await p.goto(BASE + '/demos');
  await rows.filter({ hasText: 'Mexico' }).getByRole('button', { name: 'Supprimer' }).click();
  await p.getByText('Démo de Mexico supprimée').waitFor();
  await p.getByText('Terminées (1)').waitFor();
  await p.goto(BASE + '/clients');
  await p.getByRole('heading', { name: 'Mexico' }).waitFor();
  step('« Supprimer » : la démo passe dans « Terminées », le resto reste (bot vidé)');

  if (errors.length) throw new Error('Erreurs console : ' + errors.join(' | '));
  console.log('Aucune erreur dans la console.');
  await b.close();
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
