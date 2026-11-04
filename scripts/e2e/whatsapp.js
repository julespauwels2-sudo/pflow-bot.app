/**
 * Canal WhatsApp de bout en bout, sans Meta : l'app (mode mémoire) reçoit des notifications signées
 * comme celles de Meta, et répond au faux serveur Graph (fake-meta.js).
 *   node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
 *   WHATSAPP_STORE=memory WHATSAPP_APP_SECRET=secret-test WHATSAPP_VERIFY_TOKEN=phrase-test \
 *     WHATSAPP_TOKEN=jeton-test WHATSAPP_GRAPH_BASE=http://127.0.0.1:4556 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/whatsapp.js /tmp/envois-meta.jsonl
 */
const crypto = require('crypto');
const fs = require('fs');
const LOG = process.argv[2] || '/tmp/envois-meta.jsonl';
const URL_ = 'http://localhost:3123/api/webhooks/whatsapp';
const SECRET = 'secret-test';
const PHONE = '1000000000';
const CLIENT = '590690000001';
const step = (s) => console.log('✔', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const messages = () => sent().filter((s) => s.body.type);
let n = 0;

function notif(field, items) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-demo', changes: [{ field, value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE }, contacts: [{ wa_id: CLIENT, profile: { name: 'Léa' } }],
      ...(field === 'messages' ? { messages: items } : { message_echoes: items }),
    } }] }],
  };
}
async function post(body, signed = true) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  return fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...(signed ? { 'x-hub-signature-256': sig } : {}) }, body: raw });
}
async function waitFor(check, what) {
  for (let i = 0; i < 50; i++) { if (check()) return; await sleep(100); }
  throw new Error('Délai dépassé : ' + what);
}
const text = (t) => ({ from: CLIENT, id: 'wamid.e2e' + ++n + '-' + Date.now(), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: t } });

(async () => {
  // Vérification de l'adresse par Meta.
  let r = await fetch(URL_ + '?hub.mode=subscribe&hub.verify_token=phrase-test&hub.challenge=12345');
  if (r.status !== 200 || (await r.text()) !== '12345') throw new Error('vérification GET');
  r = await fetch(URL_ + '?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=12345');
  if (r.status !== 403) throw new Error('mauvaise phrase acceptée');
  step('vérification du webhook : bonne phrase → challenge, mauvaise → 403');

  r = await post(notif('messages', [text('bonjour')]), false);
  if (r.status !== 401) throw new Error('appel non signé accepté');
  if (messages().length) throw new Error('un message est parti sans signature');
  step('appel non signé refusé (401), rien n\'est envoyé');

  const first = text('Bonjour !');
  const t0 = Date.now();
  r = await post(notif('messages', [first]));
  if (r.status !== 200) throw new Error('webhook ' + r.status);
  const ackMs = Date.now() - t0;
  await waitFor(() => messages().length >= 2, 'réponse de l\'Accueil');
  const [cta, buttons] = messages();
  if (cta.body.interactive.type !== 'cta_url' || !cta.body.interactive.action.parameters.url.includes('/c/cookies-an-nou')) throw new Error('bouton lien');
  if (buttons.body.interactive.type !== 'button') throw new Error('boutons');
  if (cta.auth !== 'Bearer jeton-test' || cta.path !== '/v24.0/' + PHONE + '/messages') throw new Error('appel Graph');
  if (!sent().some((s) => s.body.status === 'read' && s.body.typing_indicator)) throw new Error('accusé de lecture');
  step(`« Bonjour ! » → réponse 200 en ${ackMs} ms, puis Accueil envoyé à Meta (bouton « Commander » + boutons), accusé de lecture`);

  // Meta renvoie le même message : pas de doublon.
  await post(notif('messages', [first]));
  await sleep(800);
  if (messages().length !== 2) throw new Error('doublon envoyé');
  step('renvoi du même message par Meta : aucune réponse en double');

  // Clic sur un bouton.
  const infos = buttons.body.interactive.action.buttons.find((b) => b.reply.title.includes('Infos')).reply;
  await post(notif('messages', [{ from: CLIENT, id: 'wamid.click' + Date.now(), type: 'interactive', interactive: { type: 'button_reply', button_reply: infos } }]));
  await waitFor(() => messages().length >= 3, 'Infos pratiques');
  const livraisonBtn = messages()[2].body.interactive.action.buttons.find((b) => b.reply.title.includes('Livraison')).reply;
  await post(notif('messages', [{ from: CLIENT, id: 'wamid.click2' + Date.now(), type: 'interactive', interactive: { type: 'button_reply', button_reply: livraisonBtn } }]));
  await waitFor(() => messages().some((m) => m.body.text && m.body.text.body.includes('Jarry')), 'Livraison');
  const livraison = messages().find((m) => m.body.text && m.body.text.body.includes('Jarry')).body.text.body;
  if (!livraison.includes('mardi, mercredi et vendredi') || !livraison.includes('Station Vito')) throw new Error('texte livraison : ' + livraison);
  step('boutons « Infos pratiques » puis « Livraison » : jours fixes par zone et points de vente envoyés');

  // Coexistence : le gérant répond depuis son appli.
  await post(notif('smb_message_echoes', [{ from: '590690999999', to: CLIENT, id: 'wamid.echo' + Date.now(), type: 'text', text: { body: 'Je m\'en occupe 👍' } }]));
  await sleep(600);
  const before = messages().length;
  await post(notif('messages', [text('bonjour')]));
  await sleep(1000);
  if (messages().length !== before) throw new Error('le bot a répondu malgré la pause');
  step('écho du gérant (coexistence) : le bot se tait ensuite');

  console.log(`${messages().length} messages envoyés au faux Meta, aucun vrai envoi.`);
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
