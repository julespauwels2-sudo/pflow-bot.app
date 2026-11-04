/**
 * Faux serveur de l'API Graph de Meta (envoi WhatsApp) pour les tests : aucun compte Meta, aucun envoi
 * réel. Note chaque appel dans le fichier passé en argument.
 *   node scripts/e2e/fake-meta.js /tmp/envois-meta.jsonl
 */
const http = require('http');
const fs = require('fs');
const LOG = process.argv[2] || '/tmp/envois-meta.jsonl';
const PORT = Number(process.env.FAKE_META_PORT || 4556);
fs.writeFileSync(LOG, '');
let n = 0;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      fs.appendFileSync(LOG, JSON.stringify({ path: req.url, auth: req.headers.authorization, body: json }) + '\n');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json.status === 'read' ? { success: true } : { messaging_product: 'whatsapp', messages: [{ id: 'wamid.faux' + ++n }] }));
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log('Faux serveur Meta sur http://127.0.0.1:' + PORT));
