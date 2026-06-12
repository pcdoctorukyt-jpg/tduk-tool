const https = require('https');

function callClaude(prompt, apiKey) {
  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });
  return new Promise((resolve, reject) => {
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
          if (res.statusCode !== 200) reject(new Error(parsed.error?.message || 'Status ' + res.statusCode));
          else resolve(parsed.content?.[0]?.text || '');
        } catch(e) { reject(new Error('Parse error: ' + raw.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Bad request' }) };
  }

  const { videoContext, apiKey } = body;
  if (!apiKey) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing API key' }) };

  try {
    const ctx = videoContext || body.prompt || '';

    // Call 1 — strategy analysis
    const strategyPrompt = `You are a YouTube strategist for TDUK (Tech Doctor UK) — a Firestick/Fire TV/Android TV/VPN channel.

${ctx}

Reply using EXACTLY these headers, be concise:

WHY IT'S WORKING:
MAIN HOOK:
EMOTIONAL TRIGGER:
RETENTION HOOKS:
- hook 1
- hook 2
- hook 3
THUMBNAIL STRATEGY:
TITLE STRATEGY:
RISK LEVEL FOR TDUK:
BEST TDUK ANGLE:
VPN CTA ANGLE:
5 TDUK TITLE IDEAS:
1.
2.
3.
4.
5.
5 THUMBNAIL TEXT IDEAS:
1.
2.
3.
4.
5.`;

    // Call 2 — script outline only
    const scriptPrompt = `You are a YouTube scriptwriter for TDUK (Tech Doctor UK) — a Firestick/Fire TV/Android TV/VPN channel.

${ctx}

Write a detailed 6-8 minute script outline for a TDUK video on this topic. Use this exact format:

TDUK SCRIPT OUTLINE:
Intro (0:00-0:45): [Opening hook, what viewer will learn, why it matters to them]
Section 1 (0:45-2:30): [First key point with specific details]
Section 2 (2:30-4:00): [Second key point with specific details]
Section 3 (4:00-5:30): [Third key point with specific details]
VPN Segment (5:30-6:30): [Natural VPN CTA integration tied to the topic]
Outro (6:30-7:30): [Summary, subscribe CTA, next video tease]`;

    // Run both calls in parallel
    const [strategyText, scriptText] = await Promise.all([
      callClaude(strategyPrompt, apiKey),
      callClaude(scriptPrompt, apiKey)
    ]);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ text: strategyText + '\n' + scriptText })
    };

  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
