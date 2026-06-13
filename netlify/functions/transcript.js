const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': '*/*',
        'Referer': 'https://www.youtube.com/'
      }
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ body: data, status: res.statusCode }));
    }).on('error', reject);
  });
}

function extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : (url.match(/^[a-zA-Z0-9_-]{11}$/) ? url : null);
}

function cleanXml(text) {
  return text
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();
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

  const { videoUrl } = body;
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid YouTube URL' }) };

  try {
    // Strategy 1: Try YouTube's internal timedtext API directly
    // These are the known language codes to try
    const langs = ['en', 'en-GB', 'en-US', 'a.en'];
    
    for (const lang of langs) {
      try {
        const timedTextUrl = `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=srv3&name=&kind=`;
        const result = await httpGet(timedTextUrl);
        
        if (result.status === 200 && result.body && result.body.includes('<')) {
          const textMatches = result.body.match(/<s[^>]*>([\s\S]*?)<\/s>|<text[^>]*>([\s\S]*?)<\/text>/g) || [];
          const transcript = textMatches
            .map(tag => cleanXml(tag.replace(/<[^>]+>/g, ' ')))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (transcript && transcript.length > 50) {
            const trimmed = transcript.length > 8000 ? transcript.substring(0, 8000) + '...' : transcript;
            return { statusCode: 200, headers: cors, body: JSON.stringify({ transcript: trimmed, wordCount: trimmed.split(' ').length, method: 'timedtext-'+lang }) };
          }
        }
      } catch(e) { /* try next lang */ }
    }

    // Strategy 2: Try auto-generated captions endpoint
    const autoUrl = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}&fmt=srv3&kind=asr`;
    const autoResult = await httpGet(autoUrl);
    if (autoResult.status === 200 && autoResult.body && autoResult.body.includes('<')) {
      const textMatches = autoResult.body.match(/<s[^>]*>([\s\S]*?)<\/s>|<text[^>]*>([\s\S]*?)<\/text>/g) || [];
      const transcript = textMatches
        .map(tag => cleanXml(tag.replace(/<[^>]+>/g, ' ')))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (transcript && transcript.length > 50) {
        const trimmed = transcript.length > 8000 ? transcript.substring(0, 8000) + '...' : transcript;
        return { statusCode: 200, headers: cors, body: JSON.stringify({ transcript: trimmed, wordCount: trimmed.split(' ').length, method: 'auto-captions' }) };
      }
    }

    // Strategy 3: Scrape the watch page with a full browser-like request
    const pageResult = await httpGet(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
    if (pageResult.body) {
      // Look for caption tracks in the page source
      const captionMatch = pageResult.body.match(/"captionTracks":\[(.*?)\]/);
      if (captionMatch) {
        // Extract first baseUrl
        const urlMatch = captionMatch[1].match(/"baseUrl":"([^"]+)"/);
        if (urlMatch) {
          const captionUrl = urlMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
          const capResult = await httpGet(captionUrl);
          if (capResult.body && capResult.body.includes('<text')) {
            const textMatches = capResult.body.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
            const transcript = textMatches
              .map(tag => cleanXml(tag))
              .filter(Boolean)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (transcript && transcript.length > 50) {
              const trimmed = transcript.length > 8000 ? transcript.substring(0, 8000) + '...' : transcript;
              return { statusCode: 200, headers: cors, body: JSON.stringify({ transcript: trimmed, wordCount: trimmed.split(' ').length, method: 'page-scrape' }) };
            }
          }
        }
      }
    }

    // Nothing worked
    return {
      statusCode: 404,
      headers: cors,
      body: JSON.stringify({ 
        error: 'Could not fetch transcript automatically. YouTube may be blocking server requests for this video. Please paste the transcript manually — on YouTube click the three dots below the video then Show Transcript.' 
      })
    };

  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
