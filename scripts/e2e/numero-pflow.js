/**
 * Numéro PFlow (démos) de bout en bout sur le vrai serveur, sans Meta : mode mémoire (démo « Byron »
 * en cours, « Gwada Food » expirée) et faux serveur Graph.
 *   node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
 *   CHANNELS_STORE=memory WHATSAPP_APP_SECRET=secret-test WHATSAPP_VERIFY_TOKEN=phrase-test WHATSAPP_TOKEN=jeton-test \
 *     WHATSAPP_GRAPH_BASE=http://127.0.0.1:4556 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 *   node scripts/e2e/numero-pflow.js /tmp/envois-meta.jsonl
 */
const crypto = require('crypto');
const fs = require('fs');
const LOG = process.argv[2] || '/tmp/envois-meta.jsonl';
const URL_ = 'http://localhost:3123/api/webhooks/whatsapp';
const PFLOW = '1000000099';
const PROSPECT = '590690222222';
const step = (s) => console.log('✔', s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const messages = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.body.type && s.path.includes(PFLOW));
let n = 0;
async function say(t) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'w', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PFLOW }, contacts: [{ wa_id: PROSPECT, profile: { name: 'Marc' } }], messages: [{ from: PROSPECT, id: 'wamid.p' + ++n + Date.now(), type: 'text', text: { body: t } }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'secret-test').update(raw).digest('hex');
  const before = messages().length;
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  if (r.status !== 200) throw new Error('webhook ' + r.status);
  for (let i = 0; i < 50 && messages().length === before; i++) await sleep(100);
  await sleep(300);
  return messages().slice(before).map((m) => JSON.stringify(m.body)).join('\n');
}
(async () => {
  let out = await say('Bonjour');
  if (!out.includes('Ici *PFlow*')) throw new Error('bot PFlow attendu : ' + out);
  step('« Bonjour » au numéro PFlow → bot PFlow de base');
  out = await say('byron');
  if (!out.includes('Bienvenue chez Byron') || !out.includes('order.pflow.fr/demo/commande?d=0123456789abcdef0123')) throw new Error('démo Byron : ' + out);
  if (out.includes('byron-vrai-slug') || out.includes('via=wa')) throw new Error('vrai slug ou jeton dans une démo : ' + out);
  step('« byron » → démo de Byron, bouton vers la page de commande de DÉMO (jamais le vrai slug, aucun jeton)');
  out = await say('Gwada Food');
  if (!out.includes('est terminée')) throw new Error('démo expirée : ' + out);
  step('« Gwada Food » (démo expirée) → message poli');
  console.log(messages().length + ' messages envoyés au faux Meta depuis le numéro PFlow.');
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
