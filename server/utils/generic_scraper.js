import * as cheerio from 'cheerio';
import { detectPlatform, sanitizeDownloadName } from './helpers.js';
import { mediaInfoCache } from './cache.js';

/**
 * Universal Fallback Scraper for any webpage (videos, audio, single photos, and genuine multi-image galleries)
 * @param {string} targetUrl
 * @returns {Promise<object>}
 */
export async function scrapeMediaDirect(targetUrl) {
  return mediaInfoCache.getOrFetch(`scrape_${targetUrl}`, () => runScrapeMediaDirect(targetUrl));
}

// Helper: Unpack Dean Edwards packed JavaScript code (eval(function(p,a,c,k,e,d)...))
function unpackDeanEdwards(packed) {
  try {
    const pattern = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s;
    const match = pattern.exec(packed);
    if (!match) return '';

    let [, p, aStr, cStr, kStr] = match;
    let a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    let k = kStr.split('|');

    const e = (c) => (c < a ? '' : e(Math.floor(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));

    while (c--) {
      if (k[c]) {
        const regex = new RegExp('\\b' + e(c) + '\\b', 'g');
        p = p.replace(regex, k[c]);
      }
    }
    return p;
  } catch (_) {
    return '';
  }
}

// Clean and decode media URLs
function cleanMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let clean = rawUrl
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\"/g, '"')
    .trim();

  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) return null;

  // Filter out invalid/ad URLs
  const lower = clean.toLowerCase();
  if (
    lower.includes('googleads') ||
    lower.includes('doubleclick') ||
    lower.includes('googletagservices') ||
    lower.includes('blank.mp4') ||
    lower.includes('/ad/') ||
    lower.includes('ad_') ||
    lower.includes('tracker')
  ) {
    return null;
  }

  // Filter out audio-only DASH chunks that masquerade as .mp4
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
    return null;
  }

  return clean;
}

async function runScrapeMediaDirect(targetUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,video/*,*/*;q=0.8',
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
                 $('meta[name="twitter:creator"]').attr('content') ||
                 platform.name;

  // 2. Determine if page is a Video Page
  const ogType = ($('meta[property="og:type"]').attr('content') || '').toLowerCase();
  const isVideoPage = ogType.includes('video') ||
                      platform.isAdult ||
                      targetUrl.toLowerCase().includes('/video') ||
                      targetUrl.toLowerCase().includes('/watch') ||
                      targetUrl.toLowerCase().includes('/reel') ||
                      targetUrl.toLowerCase().includes('/clip') ||
                      $('video').length > 0;

  // 3. Extract Video Streams
  const foundStreams = new Map();

  function addStream(rawUrl, qualityLabel = 'Direct MP4', resolutionHeight = 720) {
    const cleanUrl = cleanMediaUrl(rawUrl);
    if (!cleanUrl) return;

    const ext = cleanUrl.includes('.m3u8') ? 'm3u8' : cleanUrl.includes('.webm') ? 'webm' : 'mp4';
    const key = cleanUrl.split('?')[0];

    let height = resolutionHeight;
    const heightMatch = cleanUrl.match(/([0-9]{3,4})p/i) || qualityLabel.match(/([0-9]{3,4})p/i);
    if (heightMatch) {
      height = parseInt(heightMatch[1], 10);
    }

    if (!foundStreams.has(key) || (foundStreams.get(key).height < height)) {
      foundStreams.set(key, {
        url: cleanUrl,
        quality: qualityLabel || `${height}p Video`,
        height: height,
        ext: ext,
        isDirectStream: true
      });
    }
  }

  // A. <video> and <source> DOM tags
  $('video, video source').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-video-url');
    const res = $(el).attr('res') || $(el).attr('label') || $(el).attr('title') || 'HD Video';
    if (src) addStream(src, res, 720);
  });

  // B. OpenGraph, Twitter, and Schema video tags
  const ogVideo = $('meta[property="og:video"]').attr('content') ||
                  $('meta[property="og:video:url"]').attr('content') ||
                  $('meta[property="og:video:secure_url"]').attr('content') ||
                  $('meta[name="twitter:player:stream"]').attr('content') ||
                  $('link[rel="video_src"]').attr('href');
  if (ogVideo) addStream(ogVideo, 'HD Video', 1080);

  // C. JSON-LD scripts
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html();
      if (!content) return;
      const json = JSON.parse(content);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item.contentUrl) addStream(item.contentUrl, 'HD Video', 1080);
        if (item.embedUrl) addStream(item.embedUrl, 'Embedded Video', 720);
        if (item.video && item.video.contentUrl) addStream(item.video.contentUrl, 'HD Video', 1080);
      }
    } catch (_) {}
  });

  // D. Script text regex extraction & JS unpacker
  const scriptTexts = [];
  $('script').each((_, el) => {
    const s = $(el).html();
    if (s) {
      scriptTexts.push(s);
      if (s.includes('eval(function(p,a,c,k,e,d)')) {
        const unpacked = unpackDeanEdwards(s);
        if (unpacked) scriptTexts.push(unpacked);
      }
    }
  });
  const fullScriptContent = scriptTexts.join('\n');

  const videoUrlPatterns = [
    /video_url\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /videoUrl\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /video_alt_url\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /quality_(\d+p?)\s*[:=]\s*['"](https?:[^'"]+)['"]/gi,
    /['"]videoUrl['"]\s*:\s*['"](https?:[^'"]+)['"]/gi,
    /['"]defaultQuality['"]\s*:\s*\[?['"](https?:[^'"]+)['"]/gi,
    /src\s*:\s*['"](https?:[^'"]+\.mp4[^'"]*)['"]/gi,
    /file\s*:\s*['"](https?:[^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/gi,
    /html5player\.setVideoUrlHigh\(['"](https?:[^'"]+)['"]\)/gi,
    /html5player\.setVideoUrlLow\(['"](https?:[^'"]+)['"]\)/gi,
    /html5player\.setVideoHLS\(['"](https?:[^'"]+)['"]\)/gi,
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

  // 4. Extract Main Thumbnail
  const mainThumbnail = $('meta[property="og:image"]').attr('content') ||
                        $('meta[property="og:image:secure_url"]').attr('content') ||
                        $('meta[name="twitter:image"]').attr('content') ||
                        $('video').attr('poster') ||
                        '';

  const streamsList = Array.from(foundStreams.values());
  const hasVideos = streamsList.length > 0;

  // 5. If this is a video page / platform and NO video streams could be found:
  // DO NOT fake a download by returning sidebar recommendation thumbnails!
  if (isVideoPage && !hasVideos) {
    throw new Error('Could not find a direct downloadable video stream on this page. The video may be protected, requires login credentials, or uses dynamic streaming.');
  }

  // 6. Handle Genuine Photo/Gallery Pages (Only if NOT a video page and NO videos were found)
  const foundImages = new Map();
  if (!hasVideos) {
    function addImage(url, source = 'image') {
      const cleanUrl = cleanMediaUrl(url);
      if (!cleanUrl) return;

      const lower = cleanUrl.toLowerCase();
      if (
        lower.includes('favicon') ||
        lower.includes('pixel') ||
        lower.includes('1x1') ||
        lower.includes('badge') ||
        lower.includes('logo') ||
        lower.includes('icon') ||
        lower.includes('avatar')
      ) {
        return;
      }

      const ext = lower.includes('.png') ? 'png' : lower.includes('.webp') ? 'webp' : 'jpg';
      const key = cleanUrl.split('?')[0];

      if (!foundImages.has(key)) {
        foundImages.set(key, { url: cleanUrl, source, ext });
      }
    }

    if (mainThumbnail) addImage(mainThumbnail, 'og');

    // Only collect large content images
    $('article img, main img, .gallery img, .post-body img, .content img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-large');
      if (src) addImage(src, 'content');
    });
  }

  const imagesList = Array.from(foundImages.values());

  if (!hasVideos && imagesList.length === 0) {
    throw new Error('Could not find downloadable media (video or photos) on this webpage.');
  }

  // Build Presets & Formats
  const presets = [];
  let carouselItems = [];
  let isMultiItem = false;

  if (hasVideos) {
    // Sort video streams: best resolution first
    streamsList.sort((a, b) => {
      if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
      if (b.ext === 'mp4' && a.ext !== 'mp4') return 1;
      return b.height - a.height;
    });

    const bestStream = streamsList[0];

    presets.push({
      id: 'direct_best_video',
      title: 'Highest Quality Video (Direct MP4)',
      badge: 'Universal MP4',
      quality: bestStream.quality || `${bestStream.height}p HD`,
      type: 'video',
      formatSelector: 'direct_stream',
      directUrl: bestStream.url,
      ext: bestStream.ext === 'm3u8' ? 'mp4' : bestStream.ext,
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

    // If multiple distinct video clips/parts exist
    if (streamsList.length > 1) {
      isMultiItem = false; // By default present as resolution options, not carousel
    }
  } else if (imagesList.length > 0) {
    const bestImage = imagesList[0];
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

    if (imagesList.length > 1) {
      isMultiItem = true;
      let itemIdx = 1;
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
    }
  }

  const videoFormats = streamsList.map((s, idx) => ({
    formatId: `stream_${idx}`,
    formatSelector: 'direct_stream',
    directUrl: s.url,
    height: s.height,
    width: 0,
    resolution: s.quality || `${s.height}p`,
    fps: 30,
    ext: s.ext === 'm3u8' ? 'mp4' : s.ext,
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
    thumbnail: mainThumbnail || (imagesList[0]?.url) || '',
    duration: 0,
    durationFormatted: hasVideos ? 'Video Stream' : isMultiItem ? `${carouselItems.length} Photos` : 'Photo Post',
    uploader: uploader,
    uploaderUrl: targetUrl,
    viewCount: null,
    likeCount: null,
    webpageUrl: targetUrl,
    platform: platform,
    isCarousel: isMultiItem,
    itemCount: carouselItems.length,
    carouselItems: carouselItems,
    presets: presets,
    videoFormats: videoFormats,
    audioFormats: [],
    defaultDownload: presets[0]
  };
}
