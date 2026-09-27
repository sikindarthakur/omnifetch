import sanitize from 'sanitize-filename';

/**
 * Format seconds into HH:MM:SS or MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Unknown duration';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format bytes into human readable size (KB, MB, GB)
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return 'Approx. Size N/A';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Clean and sanitize filename for HTTP Content-Disposition header
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeDownloadName(name, fallback = 'video') {
  if (!name || typeof name !== 'string') return fallback;
  let clean = sanitize(name).trim();
  // Remove non-ascii characters or replace with safe equivalents for header compatibility
  clean = clean.replace(/[^\x20-\x7E]/g, '').trim();
  if (!clean) clean = fallback;
  // Limit length
  if (clean.length > 100) clean = clean.substring(0, 100);
  return clean;
}

/**
 * Detect video platform from URL / extractor key
 * @param {string} url
 * @param {string} extractor
 * @returns {{ name: string, icon: string, color: string }}
 */
export function detectPlatform(url = '', extractor = '') {
  const u = (url || '').toLowerCase();
  const ext = (extractor || '').toLowerCase();

  if (u.includes('youtube.com') || u.includes('youtu.be') || ext.includes('youtube')) {
    return { name: 'YouTube', icon: 'youtube', color: '#FF0000' };
  }
  if (u.includes('instagram.com') || ext.includes('instagram')) {
    return { name: 'Instagram', icon: 'instagram', color: '#E1306C' };
  }
  if (u.includes('tiktok.com') || ext.includes('tiktok')) {
    return { name: 'TikTok', icon: 'tiktok', color: '#00F2FE' };
  }
  if (u.includes('twitter.com') || u.includes('x.com') || ext.includes('twitter')) {
    return { name: 'Twitter / X', icon: 'twitter', color: '#1DA1F2' };
  }
  if (u.includes('reddit.com') || ext.includes('reddit')) {
    return { name: 'Reddit', icon: 'reddit', color: '#FF4500' };
  }
  if (u.includes('facebook.com') || u.includes('fb.watch') || ext.includes('facebook')) {
    return { name: 'Facebook', icon: 'facebook', color: '#1877F2' };
  }
  if (u.includes('vimeo.com') || ext.includes('vimeo')) {
    return { name: 'Vimeo', icon: 'vimeo', color: '#1AB7EA' };
  }
  if (u.includes('twitch.tv') || ext.includes('twitch')) {
    return { name: 'Twitch', icon: 'twitch', color: '#9146FF' };
  }
  if (u.includes('dailymotion.com') || ext.includes('dailymotion')) {
    return { name: 'Dailymotion', icon: 'dailymotion', color: '#0066DC' };
  }
  const adultKeywords = [
    'xhamster', 'pornhub', 'xvideos', 'xnxx', 'redtube', 'youporn', 'spankbang',
    'eporner', 'hqporner', 'tube8', 'brazzers', 'tnaflix', 'drtuber', 'nuvid',
    'beeg', 'fuq', 'jav', 'hentai', 'nhentai', 'rule34', 'erome', 'daftsex',
    'thumbzilla', 'stripchat', 'chaturbate', 'camsoda', 'bongacams', 'cam4',
    'porn', 'xxx', 'sex', 'erot', 'nsfw', 'adult'
  ];

  const isAdultMatch = adultKeywords.some(kw => u.includes(kw) || ext.includes(kw));

  if (isAdultMatch) {
    const formattedName = extractor ? extractor.charAt(0).toUpperCase() + extractor.slice(1) : 'Adult Site';
    return { name: formattedName, icon: 'adult', color: '#FFA500', isAdult: true };
  }

  return { name: extractor ? extractor.charAt(0).toUpperCase() + extractor.slice(1) : 'Web Video', icon: 'globe', color: '#6366F1', isAdult: false };
}

