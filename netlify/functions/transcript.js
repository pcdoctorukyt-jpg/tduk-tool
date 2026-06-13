const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function cleanText(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
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
    // Step 1: Get the video page to find caption tracks
    const pageHtml = await get(`https://www.youtube.com/watch?v=${videoId}`);

    // Extract caption track URL from page
    const captionMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionMatch) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'No transcript available for this video. The creator may have disabled captions.' }) };
    }

    let captionTracks;
    try {
      captionTracks = JSON.parse(captionMatch[1]);
    } catch(e) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Could not parse caption data' }) };
    }

    if (!captionTracks.length) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'No captions found for this video' }) };
    }

    // Prefer English, fall back to first available
    const englishTrack = captionTracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-GB' || t.languageCode === 'en-US');
    const track = englishTrack || captionTracks[0];
    const captionUrl = track.baseUrl;

    if (!captionUrl) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Caption URL not found' }) };
    }

    // Step 2: Fetch the caption XML
    const captionXml = await get(captionUrl);

    // Step 3: Parse XML into plain text
    const textMatches = captionXml.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
    const transcript = textMatches
      .map(tag => {
        const inner = tag.replace(/<text[^>]*>/, '').replace(/<\/text>/, '');
        return cleanText(inner);
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!transcript) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Transcript was empty after parsing' }) };
    }

    // Limit to 8000 chars to keep it usable
    const trimmed = transcript.length > 8000 ? transcript.substring(0, 8000) + '...' : transcript;

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ transcript: trimmed, wordCount: trimmed.split(' ').length })
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Failed to fetch transcript: ' + e.message })
    };
  }
};
