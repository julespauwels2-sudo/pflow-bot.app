const { chromium } = require('playwright');
const OUT = process.argv[2] || '/tmp';
const BASE = 'http://localhost:3123';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ httpCredentials: { username: 'x', password: 'test123' }, viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined));
  const step = (s) => console.log('✔', s);
  const chat = () => p.locator('[data-testid="chat"]');
  const journal = () => p.locator('[data-testid="journal"]');
  const state = () => p.locator('[data-testid="state"]');
  const say = async (text) => {
    await p.getByLabel('Message du client').fill(text);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
  };
  const lastTurnHas = (text) => journal().locator('li').first().getByText(text, { exact: false }).first().waitFor();

  // Préparation : modèle + client lié
  await p.goto(BASE + '/modele');
  await p.getByRole('button', { name: 'Créer le modèle maître à partir de la trame PFlow' }).click();
  await p.locator('details[data-folder="Commande"]').waitFor();
  await p.getByRole('link', { name: 'Clients' }).click();
  await p.getByLabel('Nom du resto').fill('Cookies An Nou');
  await p.getByRole('button', { name: 'Créer le client' }).click();
  await p.getByRole('heading', { name: 'Cookies An Nou' }).click();
  await p.getByRole('button', { name: 'Créer le bot depuis le modèle' }).click();
  await p.getByText('Lié au Modèle maître').waitFor();

  await p.getByRole('link', { name: '💬 Tester le bot' }).click();
  await p.waitForURL(/\/simulateur\?client=/);
  await p.getByText('10 flux actifs · modèle + flux du client').waitFor(); // panier abandonné : option non activée
  await p.getByLabel('Délais réels').uncheck();
  step('simulateur ouvert depuis la page client : bot assemblé (modèle + client, option panier exclue)');

  // Mot-clé → Accueil
  await say('Bonjour !');
  await chat().getByRole('link', { name: '🔗 Commander' }).waitFor();
  if ((await chat().getByRole('link', { name: '🔗 Commander' }).getAttribute('href')) !== 'https://order.pflow.fr/c/cookies-an-nou') throw new Error('lien de commande');
  await lastTurnHas('Mot-clé « bonjour » reconnu → flux « Accueil »');
  await state().getByText('Bloc en attente').waitFor();
  await p.locator('.react-flow__node.sim-active').waitFor();
  await p.getByText('Bloc en attente surligné').waitFor();
  step('mot-clé : bouton lien natif, boutons de réponse, journal, état, bloc en attente surligné sur le tableau blanc');
  await p.screenshot({ path: OUT + '/a5-simulateur.png' });

  // Clic sur un bouton → Infos pratiques
  await chat().getByRole('button', { name: '↩︎ ℹ️ Infos pratiques' }).click();
  await chat().getByRole('button', { name: '↩︎ 🕒 Horaires' }).waitFor();
  if ((await p.getByLabel('Flux affiché').locator('option:checked').innerText()) !== 'Infos pratiques') throw new Error('flux affiché');
  await lastTurnHas('Flux « Infos pratiques » lancé (« Aller à un flux »)');
  step('clic sur un bouton : « Aller à un flux », le tableau blanc suit le flux en cours');

  // Texte libre pendant une attente de boutons
  await say('euh');
  await lastTurnHas('IA de secours non disponible dans le simulateur');
  await chat().getByText('Merci de choisir une des options ci-dessous 👇').waitFor();
  step('texte libre : l\'IA (A6) n\'est pas branchée, le bot repose les boutons');

  // Expiration de la session
  await p.getByRole('button', { name: '+31 min' }).click();
  await say('2');
  await lastTurnHas('Conversation expirée');
  await lastTurnHas('Ignoré : aucun mot-clé reconnu, et le canal est en mode « mots-clés uniquement »');
  step('+31 min : session expirée, puis message ignoré (mode mots-clés)');

  // Mode « à tous les messages » → flux par défaut
  await p.getByLabel('Mode de déclenchement').selectOption('toujours');
  await say('yo');
  await lastTurnHas('Flux « Accueil » lancé (aucun mot-clé : flux par défaut)');
  step('mode « à tous les messages » : flux par défaut');

  // Le gérant répond → pause, puis fin de pause
  await p.getByRole('button', { name: '👩‍💼 Le gérant répond' }).click();
  await chat().getByText('Gérant (appli WhatsApp Business)').waitFor();
  await lastTurnHas('Bot en pause pour ce contact (le gérant a répondu)');
  await state().getByText(/En pause \(le gérant a répondu\)/).waitFor();
  await say('commander');
  await lastTurnHas('Ignoré : le bot est en pause pour ce contact');
  await p.getByRole('button', { name: '+13 h' }).click();
  await say('commander');
  await lastTurnHas('La pause du bot pour ce contact est terminée');
  step('le gérant répond : pause de 12 h, message ignoré, +13 h : pause terminée');

  // Événement PFlow Order dans la fenêtre, puis hors fenêtre
  await p.getByRole('button', { name: '📦 Événement PFlow Order' }).click();
  await p.getByLabel("Type d'événement").selectOption('commande_prete');
  await p.getByRole('button', { name: "Envoyer l'événement" }).click();
  await chat().getByText(/Votre commande #1042 est prête et part en livraison/).waitFor();
  await lastTurnHas('Flux « Statut - Prête » lancé (événement PFlow Order)');
  await p.getByRole('button', { name: '+25 h' }).click();
  await p.getByRole('button', { name: '📦 Événement PFlow Order' }).click();
  await p.getByLabel("Type d'événement").selectOption('commande_prete');
  await p.getByRole('button', { name: "Envoyer l'événement" }).click();
  await lastTurnHas('Événement ignoré : fenêtre de 24 h fermée');
  await state().getByText('Fermée', { exact: true }).waitFor();
  step('événement « commande prête » envoyé, puis ignoré après +25 h (fenêtre de 24 h fermée)');

  // Lancer un flux sans mot-clé
  await p.getByLabel('Lancer un flux').selectOption({ label: 'CTA - Commander' });
  await chat().getByRole('link', { name: '🔗 😋 Je commande' }).waitFor();
  await lastTurnHas('Flux « CTA - Commander » lancé (démarrage manuel (simulateur))');
  step('« Lancer un flux » : sous-flux sans mot-clé');

  await p.getByRole('button', { name: 'Réinitialiser' }).click();
  await p.getByText('Écris comme un client').waitFor();
  if (await journal().count()) throw new Error('journal non vidé');
  step('réinitialiser la conversation');

  // Depuis l'éditeur d'un flux du modèle
  await p.goto(BASE + '/modele');
  await p.getByRole('link', { name: 'Statut - Prête', exact: true }).click();
  await p.getByRole('link', { name: '▶ Tester' }).click();
  await p.getByLabel('Client à simuler').selectOption({ label: 'Cookies An Nou' });
  await p.getByRole('button', { name: '▶ Lancer « Statut - Prête »' }).waitFor();
  if (!(await p.getByLabel('Brouillons').isChecked())) throw new Error('brouillons attendus depuis l\'éditeur');
  step('depuis l\'éditeur : simulateur sur ce flux, brouillons, choix du client pour un flux du modèle');

  console.log('erreurs/avertissements console :', errors.length ? errors : 'aucune');
  await b.close();
})().catch((e) => { console.error('ÉCHEC', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
