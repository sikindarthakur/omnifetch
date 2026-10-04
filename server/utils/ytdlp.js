import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync, createReadStream, unlink, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { formatBytes, formatDuration, detectPlatform, sanitizeDownloadName } from './helpers.js';
import { mediaInfoCache } from './cache.js';

let cachedCookiePath = null;

/**
 * Resolve cookies for yt-dlp from environment variables, files, or project root
 * @returns {string[]}
 */
export function getCookiesArg() {
  // 1. Direct environment variable containing raw cookie content (ideal for Render/Railway/Heroku)
  const envCookieContent = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES;
  if (envCookieContent && envCookieContent.trim()) {
    try {
      if (!cachedCookiePath || !existsSync(cachedCookiePath)) {
        cachedCookiePath = path.join(os.tmpdir(), `omnifetch_cookies_${process.pid}.txt`);
        writeFileSync(cachedCookiePath, envCookieContent.trim(), { encoding: 'utf8' });
      }
      return ['--cookies', cachedCookiePath];
    } catch (e) {
      console.warn('[COOKIES] Could not write env cookie file:', e.message);
    }
  }

  // 2. Direct environment variable pointing to cookie file
  const envCookieFile = process.env.YTDLP_COOKIES_FILE || process.env.COOKIES_FILE;
  if (envCookieFile && existsSync(envCookieFile)) {
    return ['--cookies', envCookieFile];
  }

  // 3. Local cookie file candidates in project root or server directory
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'cookies.txt'),
    path.join(cwd, 'youtube_cookies.txt'),
    path.join(cwd, 'server/cookies.txt'),
    path.join(cwd, 'server/youtube_cookies.txt')
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return ['--cookies', c];
    }
  }

  return [];
}

/**
 * Resolve optional proxy configuration
 * @returns {string[]}
 */
export function getProxyArgs() {
  const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY || process.env.PROXY_URL;
  if (proxy && proxy.trim()) {
    return ['--proxy', proxy.trim()];
  }
  return [];
}

// Resolve yt-dlp executable path
export function getYtDlpPath() {
  if (process.env.YTDLP_PATH && existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  const homeDir = os.homedir();
  const candidates = [
    'yt-dlp',
    path.join(homeDir, '.local/bin/yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];
  for (const c of candidates) {
    if (c === 'yt-dlp') return c; // Let system PATH resolve if available
    if (existsSync(c)) return c;
  }
  return 'yt-dlp';
}

/**
 * Fetch video metadata & available quality formats via yt-dlp with caching
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function extractVideoInfo(url) {
  return mediaInfoCache.getOrFetch(`ytdlp_${url}`, () => runYtDlpExtract(url));
}

async function runYtDlpExtract(url) {
  const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
  // Try standard web client first (with node JS runtime, extracts ALL 4K, 1080p, 720p, 480p, 360p resolutions)
  // Only rotate through alternative mobile client profiles if YouTube blocks or asks for sign-in
  const clientCombos = isYouTube
    ? [null, 'ios,mweb,web', 'mweb,tv_embedded,web', 'android,web']
    : [null];

  let lastError = null;

  for (const clientCombo of clientCombos) {
    try {
      return await executeYtDlpJson(url, clientCombo);
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      console.warn(`[YTDLP EXTRACT ATTEMPT] (client: ${clientCombo || 'default'}): ${msg}`);

      // If error indicates unavailable or private video, don't loop
      if (msg.includes('This video is unavailable') || msg.includes('Private video')) {
        throw err;
      }

      // If not a bot or block error, or not YouTube, break immediately
      if (!isYouTube || (!msg.includes('Sign in to confirm') && !msg.includes('bot') && !msg.includes('HTTP Error 429') && !msg.includes('403'))) {
        throw err;
      }
    }
  }

  if (isYouTube && lastError && (lastError.message.includes('Sign in to confirm') || lastError.message.includes('bot'))) {
    throw new Error(
      "YouTube is requesting bot verification on this server IP. Set the YOUTUBE_COOKIES environment variable in your dashboard or add a cookies.txt file to authenticate."
    );
  }

  throw lastError;
}

function executeYtDlpJson(url, clientCombo = null) {
  return new Promise((resolve, reject) => {
    const ytdlpBin = getYtDlpPath();
    const cookieArgs = getCookiesArg();
    const proxyArgs = getProxyArgs();

    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificate',
      '--ignore-errors',
      '--geo-bypass',
      '--skip-download',
      '--js-runtimes', 'node',
      '--socket-timeout', '25',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--format-sort', 'vcodec:h264,res,acodec:m4a',
      ...cookieArgs,
      ...proxyArgs
    ];

    if (clientCombo) {
      args.push('--extractor-args', `youtube:player_client=${clientCombo}`);
    }

    args.push(url);

    const proc = spawn(ytdlpBin, args);
    let stdoutData = '';
    let stderrData = '';

    // Safety timeout: 30 seconds maximum for metadata extraction
    const timeoutTimer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
        reject(new Error('Media analysis timed out. Please try again.'));
      }
    }, 30000);

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (code !== 0 || !stdoutData.trim()) {
        const errMsg = stderrData.trim() || `yt-dlp exited with error code ${code}`;
        return reject(new Error(errMsg));
      }

      try {
        const raw = JSON.parse(stdoutData.trim());
        const parsed = processVideoMetadata(raw, url);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse video information: ${err.message}`));
      }
    });
  });
}

/**
 * Process raw yt-dlp JSON into structured, user-friendly metadata & formats
 * @param {object} raw
 * @param {string} originalUrl
 * @returns {object}
 */
function processVideoMetadata(raw, originalUrl) {
  const duration = raw.duration || 0;
  const platform = detectPlatform(originalUrl, raw.extractor_key || raw.extractor);
  if (raw.age_limit && raw.age_limit >= 18) {
    platform.isAdult = true;
  }

  const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
  
  // Categorize formats
  const audioOptions = [];
  const presets = [];

  // Best Quality Preset (Auto Highest)
  presets.push({
    id: 'best_quality',
    title: 'Highest Quality (Best Video + Audio)',
    badge: 'Recommended',
    quality: 'Auto Max',
    type: 'video',
    formatSelector: 'bestvideo+bestaudio/best',
    ext: 'mp4',
    approxSize: 'Original High-Res',
    isPreset: true,
    hasAudio: true,
    icon: 'sparkles'
  });

  // Best Audio Preset
  presets.push({
    id: 'best_audio_mp3',
    title: 'High Quality MP3 Audio',
    badge: 'Audio Only',
    quality: '320kbps MP3',
    type: 'audio',
    formatSelector: 'bestaudio/best',
    ext: 'mp3',
    approxSize: duration ? formatBytes(duration * 40000) : '320kbps Studio Audio',
    isPreset: true,
    hasAudio: true,
    icon: 'music'
  });

  // Map distinct video resolutions
  const resolutionMap = new Map();

  for (const f of rawFormats) {
    // 1. Exclude storyboard / preview image tracks completely (sb0, sb1, sb2, sb3, mhtml, etc.)
    const isStoryboard = f.protocol === 'mhtml' ||
                         f.format_note === 'storyboard' ||
                         (f.format_id && String(f.format_id).startsWith('sb')) ||
                         (f.vcodec === 'none' && f.acodec === 'none');
    if (isStoryboard) continue;

    const isExplicitAudio = !f.vcodec || f.vcodec === 'none';
    const hasAudioCodec = f.acodec && f.acodec !== 'none';
    const hasVideoCodec = f.vcodec && f.vcodec !== 'none';
    
    let height = f.height || (f.resolution ? parseInt(f.resolution.split('x')[1], 10) : 0);
    if (!height && f.format_id === 'hd') height = 720;
    if (!height && f.format_id === 'sd') height = 480;

    // 2. Collect Audio only options from stream formats
    if (isExplicitAudio && hasAudioCodec) {
      const abr = f.abr ? `${Math.round(f.abr)}k` : (f.format_note || 'Audio');
      const size = f.filesize || f.filesize_approx || (duration && f.tbr ? (f.tbr * 1024 * duration) / 8 : 0);
      audioOptions.push({
        formatId: f.format_id,
        formatSelector: f.format_id,
        ext: f.ext || 'm4a',
        quality: `${abr} (${f.ext ? f.ext.toUpperCase() : 'AUDIO'})`,
        sizeFormatted: formatBytes(size),
        rawSize: size,
        acodec: f.acodec,
        note: f.format_note || `${abr} stream`,
        type: 'audio'
      });
      continue;
    }

    // 3. Collect Video options (must have real video codec and valid resolution height >= 140)
    if (hasVideoCodec && height >= 140) {
      const resKey = `${height}p`;
      const size = f.filesize || f.filesize_approx || (duration && f.tbr ? (f.tbr * 1024 * duration) / 8 : 0);
      const isProgressive = hasAudioCodec;

      // Determine label
      let label = `${height}p`;
      if (height >= 2160) label = '4K (2160p)';
      else if (height >= 1440) label = '2K (1440p)';
      else if (height >= 1080) label = '1080p Full HD';
      else if (height >= 720) label = '720p HD';
      else if (height >= 480) label = '480p SD';
      else if (height >= 360) label = '360p';
      else if (height >= 240) label = '240p';
      else if (height >= 144) label = '144p';

      const formatItem = {
        formatId: f.format_id,
        formatSelector: (f.format_id === 'hd' || f.format_id === 'sd') 
          ? `${f.format_id}/best` 
          : (isProgressive ? f.format_id : `${f.format_id}+bestaudio/best`),
        height: height,
        width: f.width || 0,
        resolution: label,
        fps: f.fps || 30,
        ext: 'mp4',
        vcodec: f.vcodec || 'h264',
        acodec: isProgressive ? (f.acodec || 'aac') : 'aac',
        hasAudio: true,
        requiresMerge: !isProgressive,
        sizeFormatted: formatBytes(size),
        rawSize: size,
        fpsLabel: f.fps && f.fps > 30 ? `${f.fps}fps` : '',
        type: 'video'
      };

      // Prefer MP4/H264 formats (avc1) or higher bitrate format for the same resolution
      const isH264 = f.vcodec && (f.vcodec.startsWith('avc') || f.vcodec.startsWith('h264') || f.ext === 'mp4');
      const existing = resolutionMap.get(resKey);
      
      if (!existing) {
        resolutionMap.set(resKey, formatItem);
      } else {
        const existingIsH264 = existing.vcodec && (existing.vcodec.startsWith('avc') || existing.vcodec.startsWith('h264') || existing.ext === 'mp4');
        if ((isH264 && !existingIsH264) || (isH264 === existingIsH264 && size > (existing.rawSize || 0))) {
          resolutionMap.set(resKey, formatItem);
        }
      }
    }
  }

  // Convert resolutionMap to sorted list (highest resolution first)
  let sortedVideoFormats = Array.from(resolutionMap.values()).sort((a, b) => (b.height || 0) - (a.height || 0));

  // Fallback if no specific video formats were resolved
  if (sortedVideoFormats.length === 0) {
    sortedVideoFormats = [
      {
        formatId: 'best_hd',
        formatSelector: 'bestvideo+bestaudio/best',
        height: 1080,
        width: 1920,
        resolution: '1080p Full HD (Best Quality)',
        fps: 30,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        hasAudio: true,
        requiresMerge: true,
        sizeFormatted: 'Original Max',
        rawSize: 0,
        fpsLabel: '',
        type: 'video'
      },
      {
        formatId: 'std_720',
        formatSelector: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        height: 720,
        width: 1280,
        resolution: '720p HD',
        fps: 30,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        hasAudio: true,
        requiresMerge: true,
        sizeFormatted: 'Optimized HD',
        rawSize: 0,
        fpsLabel: '',
        type: 'video'
      },
      {
        formatId: 'sd_480',
        formatSelector: 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
        height: 480,
        width: 854,
        resolution: '480p SD (Mobile)',
        fps: 30,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        hasAudio: true,
        requiresMerge: true,
        sizeFormatted: 'Standard SD',
        rawSize: 0,
        fpsLabel: '',
        type: 'video'
      }
    ];
  }

  // Add standard preset resolutions for quick access based on available video formats
  const standardHeights = [
    { label: '4K Ultra HD (2160p)', h: 2160, tag: 'Ultra HD' },
    { label: '2K Quad HD (1440p)', h: 1440, tag: 'Quad HD' },
    { label: '1080p Full HD', h: 1080, tag: 'Full HD' },
    { label: '720p HD', h: 720, tag: 'HD' },
    { label: '480p SD', h: 480, tag: 'SD' },
    { label: '360p (Mobile)', h: 360, tag: 'SD' },
    { label: '240p (Economy)', h: 240, tag: 'SD' },
    { label: '144p (Compact)', h: 144, tag: 'SD' }
  ];

  for (const std of standardHeights) {
    const matchingVideo = sortedVideoFormats.find(v => v.height === std.h || (v.height > 0 && Math.abs(v.height - std.h) <= 40));
    if (matchingVideo) {
      presets.push({
        id: `preset_${std.h}`,
        title: matchingVideo.resolution,
        badge: std.tag,
        quality: `${std.h}p`,
        type: 'video',
        formatSelector: matchingVideo.formatSelector,
        ext: 'mp4',
        approxSize: matchingVideo.sizeFormatted,
        isPreset: true,
        hasAudio: true,
        icon: 'video'
      });
    }
  }

  // Deduplicate stream audio options
  const uniqueAudio = [];
  const seenAudioBitrate = new Set();
  for (const a of audioOptions.sort((x, y) => (y.rawSize || 0) - (x.rawSize || 0))) {
    if (!seenAudioBitrate.has(a.quality)) {
      seenAudioBitrate.add(a.quality);
      uniqueAudio.push(a);
    }
  }

  // Ensure standard studio master audio options are ALWAYS available in Audio tab
  const studioAudioOptions = [
    {
      formatId: 'audio_mp3_320k',
      formatSelector: 'bestaudio/best',
      ext: 'mp3',
      quality: '320kbps MP3 (Studio Master)',
      sizeFormatted: duration ? formatBytes(duration * 40000) : 'Lossless MP3',
      rawSize: duration ? duration * 40000 : 8000000,
      acodec: 'MP3 LAME 320k',
      note: 'Universal Studio MP3',
      type: 'audio'
    },
    {
      formatId: 'audio_m4a_256k',
      formatSelector: 'bestaudio[ext=m4a]/bestaudio/best',
      ext: 'm4a',
      quality: '256kbps M4A / AAC (Studio)',
      sizeFormatted: duration ? formatBytes(duration * 32000) : 'HQ M4A Stream',
      rawSize: duration ? duration * 32000 : 6000000,
      acodec: 'AAC Studio Audio',
      note: 'Apple & Universal M4A',
      type: 'audio'
    },
    {
      formatId: 'audio_mp3_192k',
      formatSelector: 'bestaudio/best',
      ext: 'mp3',
      quality: '192kbps MP3 (Standard)',
      sizeFormatted: duration ? formatBytes(duration * 24000) : 'Standard MP3',
      rawSize: duration ? duration * 24000 : 4000000,
      acodec: 'MP3 192k',
      note: 'Balanced MP3 Audio',
      type: 'audio'
    }
  ];

  // Prepend studio options so user always gets pristine 320k / 256k audio tracks
  uniqueAudio.unshift(...studioAudioOptions);

  return {
    id: raw.id || 'video',
    title: raw.title || 'Extracted Video',
    description: raw.description ? raw.description.substring(0, 300) : '',
    thumbnail: raw.thumbnail || (raw.thumbnails && raw.thumbnails[0]?.url) || '',
    duration: duration,
    durationFormatted: formatDuration(duration),
    uploader: raw.uploader || raw.channel || raw.creator || platform.name,
    uploaderUrl: raw.uploader_url || raw.channel_url || '',
    viewCount: raw.view_count ? raw.view_count.toLocaleString() : null,
    likeCount: raw.like_count ? raw.like_count.toLocaleString() : null,
    webpageUrl: raw.webpage_url || originalUrl,
    platform: platform,
    presets: presets,
    videoFormats: sortedVideoFormats,
    audioFormats: uniqueAudio,
    defaultDownload: presets[0] || { formatSelector: 'bestvideo+bestaudio/best', ext: 'mp4' }
  };
}

/**
 * Stream video or audio directly to Express Response with maximum acceleration & zero black screen
 * @param {object} options
 * @param {import('express').Response} res
 */
export async function streamVideoDownload(options, res) {
  const { url, directUrl, formatSelector = 'best', ext = 'mp4', title = 'video', isAudioOnly = false } = options;
  const safeFilename = sanitizeDownloadName(title, 'media') + `.${ext}`;

  // Content headers for download
  let mimeType = 'application/octet-stream';
  if (isAudioOnly) {
    mimeType = (ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/webm');
  } else if (ext === 'jpg' || ext === 'jpeg') {
    mimeType = 'image/jpeg';
  } else if (ext === 'png') {
    mimeType = 'image/png';
  } else if (ext === 'webm') {
    mimeType = 'video/webm';
  } else {
    mimeType = 'video/mp4';
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'no-cache');

  // 1. Direct Stream Handler (e.g. progressive MP4, M3U8, or images)
  const isDirect = Boolean(directUrl) || formatSelector === 'direct_stream';
  const targetDirectUrl = directUrl || (url && url.match(/\.(mp4|webm|m3u8|jpg|jpeg|png)(\?|$)/i) ? url : null);

  if (isDirect && targetDirectUrl) {
    console.log(`[DIRECT STREAM] Piping from URL: ${targetDirectUrl.substring(0, 100)}`);
    
    // Audio Extraction from direct URL
    if (isAudioOnly && ext === 'mp3') {
      const ffmpegProc = spawn('ffmpeg', [
        '-threads', '0',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', targetDirectUrl,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-preset', 'ultrafast',
        '-f', 'mp3',
        'pipe:1'
      ]);
      ffmpegProc.stdout.pipe(res);
      ffmpegProc.on('error', (e) => console.error('[FFMPEG DIRECT ERROR]', e));
      res.on('close', () => { if (!ffmpegProc.killed) ffmpegProc.kill('SIGINT'); });
      return;
    }

    // HLS .m3u8 stream muxing to MP4
    if (targetDirectUrl.includes('.m3u8')) {
      console.log('[DIRECT M3U8] Remuxing HLS stream to MP4 on the fly...');
      const ffmpegProc = spawn('ffmpeg', [
        '-threads', '0',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', targetDirectUrl,
        '-c', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      ]);
      ffmpegProc.stdout.pipe(res);
      ffmpegProc.on('error', (e) => console.error('[FFMPEG M3U8 ERROR]', e));
      res.on('close', () => { if (!ffmpegProc.killed) ffmpegProc.kill('SIGINT'); });
      return;
    }

    // Direct HTTP file piping
    try {
      const response = await fetch(targetDirectUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': targetDirectUrl.includes('fbcdn.net') ? 'https://www.facebook.com/' : (url || targetDirectUrl)
        }
      });

      if (!response.ok) {
        throw new Error(`Direct download stream failed with status ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges) {
        res.setHeader('Accept-Ranges', acceptRanges);
      }

      const bodyStream = Readable.fromWeb(response.body);
      bodyStream.pipe(res);
      res.on('close', () => {
        bodyStream.destroy();
      });
      return;
    } catch (err) {
      console.warn('[DIRECT STREAM FALLBACK TO YTDLP]', err.message);
      // Fall through to yt-dlp pipeline
    }
  }

  // 2. High-Speed Temporary File Download Pipeline via yt-dlp
  const ytdlpBin = getYtDlpPath();
  const cookieArgs = getCookiesArg();
  const proxyArgs = getProxyArgs();
  const isYouTube = (url && (url.includes('youtube.com/') || url.includes('youtu.be/')));

  let safeFormat = formatSelector;
  if (!safeFormat || safeFormat === 'best_quality' || safeFormat === 'direct_stream') {
    safeFormat = 'bestvideo+bestaudio/best';
  } else if (!safeFormat.includes('/')) {
    safeFormat = `${safeFormat}/bestvideo+bestaudio/best`;
  }

  const tempId = `omnifetch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const tempDir = os.tmpdir();
  const tempFileTemplate = path.join(tempDir, `${tempId}.%(ext)s`);

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--geo-bypass',
    '--js-runtimes', 'node',
    '--concurrent-fragments', '8',
    '-N', '8',
    '--buffer-size', '64K',
    '--socket-timeout', '25',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--format-sort', 'vcodec:h264,res,acodec:m4a',
    ...cookieArgs,
    ...proxyArgs
  ];

  args.push('-f', safeFormat);

  if (isAudioOnly && ext === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (isAudioOnly && ext === 'm4a') {
    args.push('-x', '--audio-format', 'm4a');
  } else {
    args.push('--merge-output-format', 'mp4', '--remux-video', 'mp4');
  }

  args.push('-o', tempFileTemplate);
  args.push(url || targetDirectUrl);

  console.log(`[DOWNLOAD] Starting accelerated download & mux: ${ytdlpBin} ${args.join(' ')}`);

  const proc = spawn(ytdlpBin, args);
  let procError = '';

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('ERROR:')) {
      procError += msg + ' ';
    }
  });

  proc.on('error', (err) => {
    console.error(`[DOWNLOAD ERROR]: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: `Download failed: ${err.message}` });
    }
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`[DOWNLOAD PROCESS FAILED] Exit code: ${code}, Error: ${procError}`);
      if (!res.headersSent) {
        res.status(500).send(`Download failed: ${procError || 'Media process error'}`);
      }
      return;
    }

    // Locate the finalized file on disk
    try {
      const files = readdirSync(tempDir);
      const matchingFile = files.find(f => f.startsWith(tempId));
      if (!matchingFile) {
        throw new Error('Downloaded file could not be found.');
      }

      const filePath = path.join(tempDir, matchingFile);
      const fileStats = statSync(filePath);

      res.setHeader('Content-Length', fileStats.size);
      res.setHeader('Accept-Ranges', 'bytes');

      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);

      const cleanup = () => {
        try {
          if (existsSync(filePath)) {
            unlink(filePath, () => {});
          }
        } catch (_) {}
      };

      fileStream.on('close', cleanup);
      fileStream.on('error', cleanup);
      res.on('close', cleanup);
    } catch (err) {
      console.error(`[STREAM PIPE ERROR]: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).send(`Streaming failed: ${err.message}`);
      }
    }
  });

  // Handle client disconnection / cancel
  res.on('close', () => {
    if (!proc.killed) {
      console.log('[DOWNLOAD] Client disconnected. Terminating worker process.');
      proc.kill('SIGKILL');
    }
  });
}
