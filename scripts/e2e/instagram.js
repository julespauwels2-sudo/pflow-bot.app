/**
 * Canal Instagram de bout en bout, sans Meta : l'app (mode mémoire) reçoit des notifications signées
 * au format Instagram, et répond au faux serveur (fake-meta.js).
 *   node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
 *   CHANNELS_STORE=memory INSTAGRAM_APP_SECRET=secret-ig INSTAGRAM_VERIFY_TOKEN=phrase-ig \
 *     INSTAGRAM_TOKEN=jeton-ig INSTAGRAM_GRAPH_BASE=http://127.0.0.1:4556 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/instagram.js /tmp/envois-meta.jsonl
 */
const crypto = require('crypto');
const fs = require('fs');
const LOG = process.argv[2] || '/tmp/envois-meta.jsonl';
const URL_ = 'http://localhost:3123/api/webhooks/instagram';
const SECRET = 'secret-ig';
const ACCOUNT = '17841400000000000';
const CLIENT = 'igsid-cliente-1';
const step = (s) => console.log('✔', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const messages = () => sent().filter((s) => s.body.message);
let n = 0;

const notif = (items) => ({ object: 'instagram', entry: [{ id: ACCOUNT, time: Date.now(), messaging: items }] });
const fromClient = (message) => ({ sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: Date.now(), message: { mid: 'ig.mid' + ++n + '-' + Date.now(), ...message } });
async function post(body, signed = true) {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  return fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...(signed ? { 'x-hub-signature-256': sig } : {}) }, body: raw });
}
async function waitFor(check, what) {
  for (let i = 0; i < 50; i++) { if (check()) return; await sleep(100); }
  throw new Error('Délai dépassé : ' + what);
}

(async () => {
  let r = await fetch(URL_ + '?hub.mode=subscribe&hub.verify_token=phrase-ig&hub.challenge=777');
  if (r.status !== 200 || (await r.text()) !== '777') throw new Error('vérification GET');
  step('vérification du webhook Instagram : bonne phrase → challenge');

  r = await post(notif([fromClient({ text: 'bonjour' })]), false);
  if (r.status !== 401 || messages().length) throw new Error('appel non signé accepté');
  step('appel non signé refusé (401)');

  const first = notif([fromClient({ text: 'Bonjour !' })]);
  r = await post(first);
  if (r.status !== 200) throw new Error('webhook ' + r.status);
  await waitFor(() => messages().length >= 2, 'réponse de l\'Accueil');
  const [link, quick] = messages();
  const tpl = link.body.message.attachment && link.body.message.attachment.payload;
  if (!tpl || tpl.template_type !== 'button' || !tpl.buttons[0].url.includes('/c/cookies-an-nou')) throw new Error('bouton lien');
  if (!quick.body.message.quick_replies || quick.body.recipient.id !== CLIENT) throw new Error('réponses rapides');
  if (link.auth !== 'Bearer jeton-ig' || link.path !== '/v24.0/' + ACCOUNT + '/messages') throw new Error('appel Graph ' + link.path);
  if (!sent().some((s) => s.body.sender_action === 'mark_seen')) throw new Error('vu');
  step('« Bonjour ! » → Accueil envoyé (bouton « Commander » en modèle web_url + réponses rapides), message marqué vu');

  await post(first);
  await sleep(800);
  if (messages().length !== 2) throw new Error('doublon envoyé');
  step('renvoi du même message : aucune réponse en double');

  const infos = quick.body.message.quick_replies.find((q) => q.title.includes('Infos'));
  await post(notif([fromClient({ text: infos.title, quick_reply: { payload: infos.payload } })]));
  await waitFor(() => messages().length >= 3, 'Infos pratiques');
  step('clic sur la réponse rapide « Infos pratiques » : le menu suivant part');

  // Notre propre envoi revient en écho avec l'app_id : ignoré (le bot ne se met pas en pause).
  await post(notif([{ sender: { id: ACCOUNT }, recipient: { id: CLIENT }, timestamp: Date.now(), message: { mid: 'ig.echo-app' + Date.now(), is_echo: true, app_id: 123, text: 'Infos' } }]));
  // Le gérant répond depuis l'appli Instagram (écho sans app_id) : le bot se tait.
  await post(notif([{ sender: { id: ACCOUNT }, recipient: { id: CLIENT }, timestamp: Date.now(), message: { mid: 'ig.echo' + Date.now(), is_echo: true, text: 'Je m\'en occupe' } }]));
  await sleep(600);
  const before = messages().length;
  await post(notif([fromClient({ text: 'bonjour' })]));
  await sleep(1000);
  if (messages().length !== before) throw new Error('le bot a répondu malgré la pause');
  step('écho du gérant depuis l\'appli Instagram : le bot se tait ensuite');

  console.log(`${messages().length} messages envoyés au faux serveur, aucun vrai envoi.`);
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
