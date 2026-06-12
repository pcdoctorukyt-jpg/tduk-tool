const https = require('https');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { prompt, apiKey } = body;
  if (!apiKey) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing API key' }) };

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode !== 200) {
            resolve({ statusCode: res.statusCode, headers: cors, body: JSON.stringify({ error: parsed.error?.message || 'Status ' + res.statusCode }) });
          } else {
            resolve({ statusCode: 200, headers: cors, body: JSON.stringify({ text: parsed.content?.[0]?.text || '' }) });
          }
        } catch(e) {
          resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Parse error: ' + e.message + ' raw: ' + raw.substring(0, 200) }) });
        }
      });
    });
    req.on('error', e => resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) }));
    req.write(payload);
    req.end();
  });
};
