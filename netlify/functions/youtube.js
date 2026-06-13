const https = require('https');

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

  const { action, channelId, apiKey, videoId } = body;

  function get(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error')); }
        });
      }).on('error', reject);
    });
  }

  try {
    // Resolve channel ID from handle or URL
    if (action === 'resolveChannel') {
      const input = channelId.trim();
      let id = null;

      // Extract handle from URL if needed
      let handle = input;
      if (input.includes('youtube.com/')) {
        const match = input.match(/youtube\.com\/(@[^/?]+|channel\/([UC][^/?]+))/);
        if (match) {
          handle = match[2] || match[1]; // UC... id or @handle
        }
      }

      // If it looks like a UC channel ID already, use it directly
      if (handle.startsWith('UC') && handle.length > 20) {
        id = handle;
      } else {
        // Use forHandle API (exact match, no search guessing)
        const cleanHandle = handle.startsWith('@') ? handle.substring(1) : handle;
        const handleUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(cleanHandle)}&key=${apiKey}`;
        const handleData = await get(handleUrl);

        if (handleData.items?.length) {
          id = handleData.items[0].id;
          const ch = handleData.items[0];
          return { statusCode: 200, headers: cors, body: JSON.stringify({
            channelId: id,
            name: ch.snippet.title,
            thumbnail: ch.snippet.thumbnails?.default?.url,
            subscribers: parseInt(ch.statistics.subscriberCount) || 0,
          })};
        }

        // Fallback: search (less accurate but better than nothing)
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent('@'+cleanHandle)}&maxResults=1&key=${apiKey}`;
        const searchData = await get(searchUrl);
        if (searchData.error) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: searchData.error.message }) };
        if (!searchData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found. Try pasting the UC... Channel ID manually.' }) };
        id = searchData.items[0].snippet.channelId;
      }

      // Get channel stats by ID
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${id}&key=${apiKey}`;
      const channelData = await get(channelUrl);
      if (!channelData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found' }) };
      const ch = channelData.items[0];
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        channelId: id,
        name: ch.snippet.title,
        thumbnail: ch.snippet.thumbnails?.default?.url,
        subscribers: parseInt(ch.statistics.subscriberCount) || 0,
      })};
    }

    // Fetch latest videos from a channel
    if (action === 'fetchVideos') {
      // Get uploads playlist ID
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id=${channelId}&key=${apiKey}`;
      const chData = await get(chUrl);
      if (!chData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found' }) };
      const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

      // Get latest 20 videos
      const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=20&key=${apiKey}`;
      const plData = await get(plUrl);
      if (!plData.items?.length) return { statusCode: 200, headers: cors, body: JSON.stringify({ videos: [] }) };

      const videoIds = plData.items.map(i => i.snippet.resourceId.videoId).join(',');

      // Get video stats
      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${apiKey}`;
      const statsData = await get(statsUrl);

      const videos = statsData.items.map(v => ({
        youtubeId: v.id,
        title: v.snippet.title,
        description: v.snippet.description?.substring(0, 500) || '',
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
        uploadDate: v.snippet.publishedAt,
        views: parseInt(v.statistics.viewCount) || 0,
        likes: parseInt(v.statistics.likeCount) || 0,
        comments: parseInt(v.statistics.commentCount) || 0,
        url: `https://youtube.com/watch?v=${v.id}`
      }));

      return { statusCode: 200, headers: cors, body: JSON.stringify({ videos }) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
