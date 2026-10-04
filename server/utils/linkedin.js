import * as cheerio from 'cheerio';
import { sanitizeDownloadName } from './helpers.js';
import { mediaInfoCache } from './cache.js';

/**
 * Extract LinkedIn Post, Video, Image, or Multi-Image Document/Carousel
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function extractLinkedIn(url) {
  return mediaInfoCache.getOrFetch(`linkedin_${url}`, () => runLinkedInExtract(url));
}

async function runLinkedInExtract(url) {
  // Extract LinkedIn ID (numeric or URN)
  let id = '';
  const numMatch = url.match(/([0-9]{15,22})/);
  if (numMatch) {
    id = numMatch[1];
  } else {
    const actMatch = url.match(/activity-([0-9]+)/);
    if (actMatch) id = actMatch[1];
  }

  if (!id) {
    throw new Error('Could not parse LinkedIn Post ID from URL.');
  }

  // Probe LinkedIn embed URLs
  const candidateUrls = [
    `https://www.linkedin.com/embed/feed/update/urn:li:share:${id}`,
    `https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:${id}`,
    `https://www.linkedin.com/embed/feed/update/urn:li:activity:${id}`
  ];

  let html = '';
  let successfulUrl = '';

  for (const embedUrl of candidateUrls) {
    try {
      const res = await fetch(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('licdn.com') || text.includes('data-sources') || text.includes('<video') || text.includes('<img')) {
          html = text;
          successfulUrl = embedUrl;
          break;
        }
      }
    } catch (_) {}
  }

  if (!html) {
    // Try fetching the original URL directly
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      }
    });
    html = await res.text();
  }

  const $ = cheerio.load(html);

  // Extract author / title
  let author = $('.actor-name').text().trim() ||
               $('meta[name="author"]').attr('content') ||
               'LinkedIn Creator';
  let title = $('.commentary').text().replace(/\s+/g, ' ').trim() ||
              $('title').text().replace(/\s+/g, ' ').trim() ||
              `LinkedIn Post by ${author}`;
  if (title.length > 120) title = title.substring(0, 117) + '...';

  // 1. Extract Videos
  const foundVideos = new Set();
  const videoRegexes = [
    /data-sources="([^"]+)"/g,
    /https:\/\/[a-zA-Z0-9_\-\.\/]+\.mp4(?:\?[^"'\s<>]*)?/g,
    /data-delayed-url="([^"]+\.mp4[^"]*)"/g
  ];

  for (const r of videoRegexes) {
    let m;
    while ((m = r.exec(html)) !== null) {
      let vUrl = m[1] || m[0];
      if (vUrl.includes('&quot;')) {
        vUrl = vUrl.replace(/&quot;/g, '"');
        try {
          const parsed = JSON.parse(vUrl);
          if (Array.isArray(parsed)) {
            parsed.forEach(item => { if (item.src) foundVideos.add(item.src); });
          }
        } catch (_) {}
      } else if (vUrl.startsWith('http')) {
        foundVideos.add(vUrl.replace(/&amp;/g, '&'));
      }
    }
  }

  // 2. Extract High-Resolution Images
  const foundImages = new Map();
  const imageRegex = /https:\/\/media\.licdn\.com\/dms\/image\/[a-zA-Z0-9_\-\.\/\?=&;%]+/g;
  let imgMatch;
  while ((imgMatch = imageRegex.exec(html)) !== null) {
    let imgUrl = imgMatch[0].replace(/&amp;/g, '&');
    // Filter out tiny icons, profile avatars if large images exist
    const isProfile = imgUrl.includes('profile-displayphoto') || imgUrl.includes('shrink_100_100') || imgUrl.includes('shrink_200_200');
    const isFeedshare = imgUrl.includes('feedshare') || imgUrl.includes('shrink_800') || imgUrl.includes('shrink_1280') || imgUrl.includes('sync-');

    // Upgrade shrink size to max 1280 / 2048 if possible
    const highResUrl = imgUrl.replace(/feedshare-shrink_\d+/, 'feedshare-shrink_1280');
    const baseKey = highResUrl.split('?')[0];

    if (!foundImages.has(baseKey) || (isFeedshare && !foundImages.get(baseKey).isFeedshare)) {
      foundImages.set(baseKey, {
        url: highResUrl,
        isFeedshare: isFeedshare,
        isProfile: isProfile
      });
    }
  }

  // Filter images: if feedshare images exist, exclude profile avatar icons
  let imageList = Array.from(foundImages.values());
  const feedshareOnly = imageList.filter(img => img.isFeedshare || !img.isProfile);
  if (feedshareOnly.length > 0) {
    imageList = feedshareOnly;
  }

  const videoList = Array.from(foundVideos);
  const totalItemsCount = videoList.length + imageList.length;

  if (totalItemsCount === 0) {
    throw new Error('No public media found on this LinkedIn post.');
  }

  // Build Carousel items list
  const carouselItems = [];
  let itemIndex = 1;

  videoList.forEach((vUrl) => {
    carouselItems.push({
      index: itemIndex++,
      type: 'video',
      url: vUrl,
      thumbnail: imageList[0]?.url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60',
      ext: 'mp4',
      title: `${sanitizeDownloadName(author)}_linkedin_video_${itemIndex - 1}`
    });
  });

  imageList.forEach((img) => {
    carouselItems.push({
      index: itemIndex++,
      type: 'image',
      url: img.url,
      thumbnail: img.url,
      ext: 'jpg',
      title: `${sanitizeDownloadName(author)}_linkedin_photo_${itemIndex - 1}`
    });
  });

  const isMultiItem = carouselItems.length > 1;
  const primaryItem = carouselItems[0];
  const isVideo = primaryItem.type === 'video';

  const presets = [];
  if (isVideo) {
    presets.push({
      id: 'linkedin_video_best',
      title: 'High Quality LinkedIn Video (MP4)',
      badge: 'Universal MP4',
      quality: 'HD Video',
      type: 'video',
      formatSelector: 'direct_stream',
      directUrl: primaryItem.url,
      ext: 'mp4',
      approxSize: 'Original HD',
      isPreset: true,
      hasAudio: true,
      icon: 'sparkles'
    });
    presets.push({
      id: 'linkedin_audio_mp3',
      title: 'Extract Audio (MP3)',
      badge: 'Audio Only',
      quality: '320kbps MP3',
      type: 'audio',
      formatSelector: 'bestaudio/best',
      directUrl: primaryItem.url,
      ext: 'mp3',
      approxSize: 'Audio Track',
      isPreset: true,
      hasAudio: true,
      icon: 'music'
    });
  } else {
    presets.push({
      id: 'linkedin_photo_best',
      title: 'High Resolution Photo (JPG)',
      badge: 'Original HD',
      quality: 'Max Resolution',
      type: 'image',
      formatSelector: 'direct_stream',
      directUrl: primaryItem.url,
      ext: 'jpg',
      approxSize: 'Original Image',
      isPreset: true,
      hasAudio: false,
      icon: 'sparkles'
    });
  }

  return {
    id: id,
    title: title,
    description: '',
    thumbnail: primaryItem.thumbnail || primaryItem.url,
    duration: 0,
    durationFormatted: isVideo ? 'LinkedIn Video' : isMultiItem ? `${carouselItems.length} Slides / Images` : 'LinkedIn Photo',
    uploader: author,
    uploaderUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`,
    viewCount: null,
    likeCount: null,
    webpageUrl: url,
    platform: {
      name: 'LinkedIn',
      icon: 'linkedin',
      color: '#0A66C2'
    },
    isCarousel: isMultiItem,
    itemCount: carouselItems.length,
    carouselItems: carouselItems,
    presets: presets,
    videoFormats: isVideo ? [
      {
        formatId: 'linkedin_video',
        formatSelector: 'direct_stream',
        directUrl: primaryItem.url,
        height: 720,
        width: 1280,
        resolution: '720p HD',
        fps: 30,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        hasAudio: true,
        requiresMerge: false,
        sizeFormatted: 'Original Video',
        rawSize: 0,
        fpsLabel: '',
        type: 'video'
      }
    ] : [],
    audioFormats: [],
    defaultDownload: presets[0]
  };
}
