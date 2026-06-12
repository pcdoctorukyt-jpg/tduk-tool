const https = require('https');

function callClaude(prompt, apiKey, maxTokens) {
  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens || 1200,
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

  const ctx = videoContext || '';

  // Prompt 1: strategy (concise)
  const p1 = `YouTube strategist for TDUK (Firestick/Fire TV/VPN channel). Analyse this video briefly.

${ctx}

Use EXACTLY these headers, one short answer each:

WHY IT'S WORKING:
MAIN HOOK:
EMOTIONAL TRIGGER:
RETENTION HOOKS:
- 
- 
- 
THUMBNAIL STRATEGY:
TITLE STRATEGY:
RISK LEVEL FOR TDUK:
BEST TDUK ANGLE:
VPN CTA ANGLE:`;

  // Prompt 2: titles and thumbnails
  const p2 = `YouTube strategist for TDUK (Firestick/Fire TV/VPN channel).

${ctx}

Give ONLY these, nothing else:

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

  // Prompt 3: script outline only — dedicated call with plenty of tokens
  const p3 = `You are writing a YouTube script outline for TDUK (Tech Doctor UK), a Firestick and streaming device channel.

${ctx}

Write a detailed 6-8 minute script outline. Each section must have 2-3 sentences of detail. Use this exact format:

TDUK SCRIPT OUTLINE:
Intro (0:00-0:45): [Hook line. What viewer will learn. Why it matters to them specifically.]
Section 1 (0:45-2:30): [What to cover. Specific talking points. Any visuals or demos needed.]
Section 2 (2:30-4:00): [What to cover. Specific talking points. Any visuals or demos needed.]
Section 3 (4:00-5:30): [What to cover. Specific talking points. Any visuals or demos needed.]
VPN Segment (5:30-6:30): [How to naturally introduce VPN. Specific angle tied to this topic. Suggested CTA wording.]
Outro (6:30-7:30): [Key takeaways to recap. Subscribe prompt. Tease of next video.]`;

  try {
    const [t1, t2, t3] = await Promise.all([
      callClaude(p1, apiKey, 800),
      callClaude(p2, apiKey, 400),
      callClaude(p3, apiKey, 1000)
    ]);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ text: t1 + '\n' + t2 + '\n' + t3 })
    };
  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
