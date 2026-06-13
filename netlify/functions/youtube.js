const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0,100))); }
      });
    }).on('error', reject);
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

  const { action, channelId, apiKey, maxResults } = body;

  try {
    if (action === 'resolveChannel') {
      const input = channelId.trim();
      let id = null;

      let handle = input;
      if (input.includes('youtube.com/')) {
        const match = input.match(/youtube\.com\/(@[^/?]+|channel\/([UC][^/?]+))/);
        if (match) handle = match[2] || match[1];
      }

      if (handle.startsWith('UC') && handle.length > 20) {
        id = handle;
      } else {
        const cleanHandle = handle.startsWith('@') ? handle.substring(1) : handle;
        const handleUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(cleanHandle)}&key=${apiKey}`;
        const handleData = await get(handleUrl);
        if (handleData.items?.length) {
          const ch = handleData.items[0];
          return { statusCode: 200, headers: cors, body: JSON.stringify({
            channelId: ch.id, name: ch.snippet.title,
            thumbnail: ch.snippet.thumbnails?.default?.url,
            subscribers: parseInt(ch.statistics.subscriberCount) || 0,
          })};
        }
        // Fallback search
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent('@'+cleanHandle)}&maxResults=1&key=${apiKey}`;
        const searchData = await get(searchUrl);
        if (!searchData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found. Paste the UC... Channel ID manually.' }) };
        id = searchData.items[0].snippet.channelId;
      }

      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${id}&key=${apiKey}`;
      const channelData = await get(channelUrl);
      if (!channelData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found' }) };
      const ch = channelData.items[0];
      return { statusCode: 200, headers: cors, body: JSON.stringify({
        channelId: id, name: ch.snippet.title,
        thumbnail: ch.snippet.thumbnails?.default?.url,
        subscribers: parseInt(ch.statistics.subscriberCount) || 0,
      })};
    }

    if (action === 'fetchVideos') {
      const limit = Math.min(maxResults || 50, 100);
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id=${channelId}&key=${apiKey}`;
      const chData = await get(chUrl);
      if (!chData.items?.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Channel not found' }) };
      const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

      // Fetch up to 100 videos using pagination
      let allItems = [];
      let pageToken = '';
      while (allItems.length < limit) {
        const remaining = limit - allItems.length;
        const pageSize = Math.min(remaining, 50);
        let plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=${pageSize}&key=${apiKey}`;
        if (pageToken) plUrl += `&pageToken=${pageToken}`;
        const plData = await get(plUrl);
        if (!plData.items?.length) break;
        allItems = allItems.concat(plData.items);
        if (!plData.nextPageToken || allItems.length >= limit) break;
        pageToken = plData.nextPageToken;
      }

      if (!allItems.length) return { statusCode: 200, headers: cors, body: JSON.stringify({ videos: [] }) };

      // Fetch stats in batches of 50
      const videoIds = allItems.map(i => i.snippet.resourceId.videoId);
      let allVideoStats = [];
      for (let i = 0; i < videoIds.length; i += 50) {
        const batch = videoIds.slice(i, i + 50).join(',');
        const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batch}&key=${apiKey}`;
        const statsData = await get(statsUrl);
        if (statsData.items) allVideoStats = allVideoStats.concat(statsData.items);
      }

      const videos = allVideoStats.map(v => ({
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
