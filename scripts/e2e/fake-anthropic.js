/**
 * Faux serveur de l'API Anthropic pour les tests de bout en bout (aucune clé, aucun coût).
 * Répond à POST /v1/messages selon le dernier message du client, et note chaque requête reçue
 * dans le fichier passé en argument (pour vérifier le prompt, le cache et le format de sortie).
 *
 *   node scripts/e2e/fake-anthropic.js /tmp/requetes-ia.jsonl
 *   ANTHROPIC_API_KEY=cle-de-test ANTHROPIC_BASE_URL=http://127.0.0.1:4555 BASIC_AUTH_PASSWORD=test123 PORT=3123 npm start
 */
const http = require('http');
const fs = require('fs');

const LOG = process.argv[2] || '/tmp/requetes-ia.jsonl';
const PORT = Number(process.env.FAKE_ANTHROPIC_PORT || 4555);
fs.writeFileSync(LOG, '');

function decide(text) {
  const t = text.toLowerCase();
  if (t.includes('faim')) return { action: 'fonction', fonction: 'lancer_commande', texte: '' };
  if (t.includes('chocolat')) return { action: 'fonction', fonction: 'proposer_commande', texte: '🍫 Le *Tout choco* est fait pour vous : cœur fondant, 70 % de cacao.' };
  if (t.includes('personne')) return { action: 'fonction', fonction: 'parler_equipe', texte: '' };
  if (t.includes('livr')) return { action: 'repondre', texte: '🛵 *Prochaine livraison* : jeudi à Jarry, de 11h à 13h.' };
  return { action: 'repondre', texte: 'Je n’ai pas cette information, je peux vous mettre en relation avec l’équipe.' };
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
      }
      const params = JSON.parse(body);
      fs.appendFileSync(LOG, JSON.stringify({ apiKey: req.headers['x-api-key'], params }) + '\n');
      const last = params.messages[params.messages.length - 1].content;
      const text = typeof last === 'string' ? last : last.map((b) => b.text).join('');
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: params.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(decide(text)) }],
          usage: { input_tokens: 350, output_tokens: 45, cache_read_input_tokens: 2400, cache_creation_input_tokens: 0 },
        }),
      );
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Faux serveur Anthropic sur http://127.0.0.1:${PORT}`));
