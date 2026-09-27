import * as cheerio from 'cheerio';
import { detectPlatform, sanitizeDownloadName } from './helpers.js';
import { mediaInfoCache } from './cache.js';

/**
 * Universal Fallback Scraper for any webpage (videos, audio, single photos, and multi-image galleries)
 * @param {string} targetUrl
 * @returns {Promise<object>}
 */
export async function scrapeMediaDirect(targetUrl) {
  return mediaInfoCache.getOrFetch(targetUrl, () => runScrapeMediaDirect(targetUrl));
}

async function runScrapeMediaDirect(targetUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': targetUrl
  };

  const response = await fetch(targetUrl, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} when fetching webpage.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const platform = detectPlatform(targetUrl);

  // 1. Extract Page Title & Uploader
  let title = $('meta[property="og:title"]').attr('content') ||
              $('meta[name="twitter:title"]').attr('content') ||
              $('h1').first().text().trim() ||
              $('title').text() ||
              'Web Media';
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length > 120) title = title.substring(0, 117) + '...';

  let uploader = $('meta[name="author"]').attr('content') ||
                 $('meta[property="article:author"]').attr('content') ||
                 platform.name;

  // 2. Extract Video Streams
  const foundStreams = new Map();

  function addStream(url, qualityLabel = 'Direct MP4', resolutionHeight = 720) {
    if (!url || typeof url !== 'string') return;
    let cleanUrl = url.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) return;

    if (cleanUrl.includes('ads') || cleanUrl.includes('tracker') || cleanUrl.includes('blank.mp4')) return;

    // Filter out audio-only DASH chunks that masquerade as .mp4
    const lower = cleanUrl.toLowerCase();
    if (
      lower.includes('audio') ||
      lower.includes('sound') ||
      lower.includes('voice') ||
      lower.includes('dash_audio') ||
      lower.includes('preview_audio') ||
      lower.includes('bytestart') ||
      lower.includes('itag=140') ||
      lower.includes('itag=251') ||
      lower.includes('itag=249') ||
      lower.includes('itag=250') ||
      lower.includes('itag=139')
    ) {
      return;
    }

    const ext = cleanUrl.includes('.m3u8') ? 'm3u8' : cleanUrl.includes('.webm') ? 'webm' : 'mp4';
    const key = cleanUrl.split('?')[0];

    if (!foundStreams.has(key)) {
      foundStreams.set(key, {
        url: cleanUrl,
        quality: qualityLabel,
        height: resolutionHeight,
        ext: ext,
        isDirectStream: true
      });
    }
  }

  // <video> and <source>
  $('video, video source').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    const res = $(el).attr('res') || $(el).attr('label') || 'HD Video';
    if (src) addStream(src, res, 720);
  });

  // OpenGraph & Twitter video
  const ogVideo = $('meta[property="og:video"]').attr('content') ||
                  $('meta[property="og:video:url"]').attr('content') ||
                  $('meta[property="og:video:secure_url"]').attr('content') ||
                  $('meta[name="twitter:player:stream"]').attr('content');
  if (ogVideo) addStream(ogVideo, 'HD Video', 1080);

  // Script text regex
  const scriptTexts = [];
  $('script').each((_, el) => {
    const s = $(el).html();
    if (s) scriptTexts.push(s);
  });
  const fullScriptContent = scriptTexts.join('\n');

  const videoUrlPatterns = [
    /video_url\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /videoUrl\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /quality_(\d+p?)\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /['"]videoUrl['"]\s*:\s*['"](https?:[^'"]+)['"]/gi,
    /['"]defaultQuality['"]\s*:\s*\[?['"](https?:[^'"]+)['"]/gi,
    /src\s*:\s*['"](https?:[^'"]+\.mp4[^'"]*)['"]/gi,
    /file\s*:\s*['"](https?:[^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/gi,
    /['"](https?:\\\/\\\/[a-zA-Z0-9_\-\.\/]+\.mp4(?:\?[^'"]*)?)['"]/gi,
    /['"](https?:\\\/\\\/[a-zA-Z0-9_\-\.\/]+\.m3u8(?:\?[^'"]*)?)['"]/gi,
    /(https?:\/\/[a-zA-Z0-9_\-\.\/]+\.mp4(?:\?[^'"\s<>]*)?)/gi
  ];

  for (const pattern of videoUrlPatterns) {
    let m;
    while ((m = pattern.exec(fullScriptContent)) !== null) {
      if (m[2]) {
        const h = parseInt(m[1], 10) || 720;
        addStream(m[2], `${h}p Video`, h);
      } else if (m[1]) {
        addStream(m[1], 'High Quality MP4', 720);
      }
    }
  }

  // 3. Extract High-Resolution Images / Gallery
  const foundImages = new Map();

  function addImage(url, source = 'image') {
    if (!url || typeof url !== 'string') return;
    let cleanUrl = url.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) return;

    // Exclude icons, avatars, tracking pixels
    const lower = cleanUrl.toLowerCase();
    if (lower.includes('favicon') || lower.includes('pixel') || lower.includes('1x1') || lower.includes('badge') || lower.includes('logo') || lower.includes('icon')) {
      return;
    }

    const ext = lower.includes('.png') ? 'png' : lower.includes('.webp') ? 'webp' : 'jpg';
    const key = cleanUrl.split('?')[0];

    if (!foundImages.has(key)) {
      foundImages.set(key, {
        url: cleanUrl,
        source: source,
        ext: ext
      });
    }
  }

  // Meta images
  const ogImg = $('meta[property="og:image"]').attr('content') ||
                $('meta[property="og:image:secure_url"]').attr('content') ||
                $('meta[name="twitter:image"]').attr('content') ||
                $('meta[name="twitter:image:src"]').attr('content');
  if (ogImg) addImage(ogImg, 'og');

  // DOM <img> tags
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-large');
    const width = parseInt($(el).attr('width') || '300', 10);
    const height = parseInt($(el).attr('height') || '300', 10);
    if (src && width > 150 && height > 150) {
      addImage(src, 'dom');
    }
  });

  const streamsList = Array.from(foundStreams.values());
  const imagesList = Array.from(foundImages.values());

  if (streamsList.length === 0 && imagesList.length === 0) {
    throw new Error('Could not find downloadable media (videos or images) on this webpage.');
  }

  const hasVideos = streamsList.length > 0;
  // Carousel is active if it is a multi-photo post/gallery without a primary video, or a multi-post album
  const isMultiMedia = (!hasVideos && imagesList.length > 1) || (hasVideos && imagesList.length > 4);

  // Build unified carousel items
  const carouselItems = [];
  let itemIdx = 1;

  streamsList.forEach((s) => {
    carouselItems.push({
      index: itemIdx++,
      type: 'video',
      url: s.url,
      thumbnail: imagesList[0]?.url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60',
      ext: s.ext,
      title: `${sanitizeDownloadName(title)}_video_${itemIdx - 1}`
    });
  });

  imagesList.forEach((img) => {
    carouselItems.push({
      index: itemIdx++,
      type: 'image',
      url: img.url,
      thumbnail: img.url,
      ext: img.ext,
      title: `${sanitizeDownloadName(title)}_image_${itemIdx - 1}`
    });
  });

  // Sort video streams: best resolution first
  streamsList.sort((a, b) => {
    if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
    if (b.ext === 'mp4' && a.ext !== 'mp4') return 1;
    return b.height - a.height;
  });

  const bestStream = streamsList[0];
  const bestImage = imagesList[0];
  const thumbnail = (bestImage && bestImage.url) || $('video').attr('poster') || '';

  const presets = [];
  if (hasVideos) {
    presets.push({
      id: 'direct_best_video',
      title: 'Highest Quality Video (Direct MP4)',
      badge: 'Universal MP4',
      quality: bestStream.quality || 'Original HD',
      type: 'video',
      formatSelector: 'direct_stream',
      directUrl: bestStream.url,
      ext: bestStream.ext,
      approxSize: 'Original HD',
      isPreset: true,
      hasAudio: true,
      icon: 'sparkles'
    });
    presets.push({
      id: 'direct_audio_mp3',
      title: 'Extract Audio (MP3)',
      badge: 'Audio Only',
      quality: '320kbps MP3',
      type: 'audio',
      formatSelector: 'bestaudio/best',
      directUrl: bestStream.url,
      ext: 'mp3',
      approxSize: 'Audio Stream',
      isPreset: true,
      hasAudio: true,
      icon: 'music'
    });
  } else if (bestImage) {
    presets.push({
      id: 'direct_photo_best',
      title: 'High Resolution Photo (HD Image)',
      badge: 'Original HD',
      quality: 'Max Resolution',
      type: 'image',
      formatSelector: 'direct_stream',
      directUrl: bestImage.url,
      ext: bestImage.ext,
      approxSize: 'Original Photo',
      isPreset: true,
      hasAudio: false,
      icon: 'sparkles'
    });
  }

  const videoFormats = streamsList.map((s, idx) => ({
    formatId: `stream_${idx}`,
    formatSelector: 'direct_stream',
    directUrl: s.url,
    height: s.height,
    width: 0,
    resolution: s.quality || `${s.height}p`,
    fps: 30,
    ext: s.ext,
    vcodec: 'h264',
    acodec: 'aac',
    hasAudio: true,
    requiresMerge: false,
    sizeFormatted: 'Original File',
    rawSize: 0,
    fpsLabel: '',
    type: 'video'
  }));

  return {
    id: 'scraped_media',
    title: title,
    description: '',
    thumbnail: thumbnail,
    duration: 0,
    durationFormatted: hasVideos ? 'Video Stream' : isMultiMedia ? `${carouselItems.length} Photos` : 'Photo Post',
    uploader: uploader,
    uploaderUrl: targetUrl,
    viewCount: null,
    likeCount: null,
    webpageUrl: targetUrl,
    platform: platform,
    isCarousel: isMultiMedia,
    itemCount: carouselItems.length,
    carouselItems: carouselItems,
    presets: presets,
    videoFormats: videoFormats,
    audioFormats: [],
    defaultDownload: presets[0]
  };
}
