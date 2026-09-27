import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'analytics.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory metrics structure
let stats = {
  totalVisits: 0,
  totalDownloads: 0,
  totalFetches: 0,
  dailyVisits: {}, // "YYYY-MM-DD": count
  dailyUniqueVisitors: {}, // "YYYY-MM-DD": Set of hashed IPs (saved as array/count)
  platformBreakdown: {
    'YouTube': 0,
    'Instagram': 0,
    'TikTok': 0,
    'Twitter / X': 0,
    'Reddit': 0,
    'LinkedIn': 0,
    'Facebook': 0,
    'Vimeo': 0,
    'Adult Platforms': 0,
    'Other Web Platforms': 0
  },
  recentEvents: [],
  startedAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString()
};

// Load existing stats if available
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    stats = {
      ...stats,
      ...parsed,
      platformBreakdown: { ...stats.platformBreakdown, ...(parsed.platformBreakdown || {}) }
    };
  }
} catch (e) {
  console.warn('[ANALYTICS] Could not load stored analytics, starting fresh:', e.message);
}

// Save stats debounced to disk
let saveTimeout = null;
function persistStats() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    try {
      stats.lastUpdated = new Date().toISOString();
      // Keep only last 30 days of daily data
      const dates = Object.keys(stats.dailyVisits).sort();
      if (dates.length > 30) {
        const toDelete = dates.slice(0, dates.length - 30);
        toDelete.forEach(d => {
          delete stats.dailyVisits[d];
          delete stats.dailyUniqueVisitors[d];
        });
      }
      // Keep only last 50 recent events
      if (stats.recentEvents.length > 50) {
        stats.recentEvents = stats.recentEvents.slice(-50);
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (err) {
      console.error('[ANALYTICS SAVE ERROR]', err.message);
    } finally {
      saveTimeout = null;
    }
  }, 3000);
}

/**
 * Anonymize IP with salt and date (GDPR compliant - no raw PII stored)
 */
function hashVisitor(ip, userAgent) {
  const salt = 'omnifetch_privacy_salt_2026';
  const today = new Date().toISOString().split('T')[0];
  return crypto.createHash('sha256').update(`${ip || 'unknown'}-${userAgent || ''}-${today}-${salt}`).digest('hex').substring(0, 16);
}

/**
 * Record a page visit
 */
export function recordVisit(req) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const visitorHash = hashVisitor(ip, userAgent);

    stats.totalVisits += 1;
    stats.dailyVisits[today] = (stats.dailyVisits[today] || 0) + 1;

    if (!Array.isArray(stats.dailyUniqueVisitors[today])) {
      stats.dailyUniqueVisitors[today] = [];
    }
    if (!stats.dailyUniqueVisitors[today].includes(visitorHash)) {
      stats.dailyUniqueVisitors[today].push(visitorHash);
    }

    persistStats();
  } catch (e) {
    console.error('[ANALYTICS VISIT ERROR]', e.message);
  }
}

/**
 * Record a media fetch event
 */
export function recordFetch(platformName = 'Other Web Platforms', url = '') {
  try {
    stats.totalFetches += 1;
    const cleanPlatform = mapPlatformCategory(platformName);
    stats.platformBreakdown[cleanPlatform] = (stats.platformBreakdown[cleanPlatform] || 0) + 1;

    stats.recentEvents.push({
      type: 'fetch',
      platform: cleanPlatform,
      timestamp: new Date().toISOString()
    });

    persistStats();
  } catch (e) {
    console.error('[ANALYTICS FETCH ERROR]', e.message);
  }
}

/**
 * Record a media download event
 */
export function recordDownload(platformName = 'Other Web Platforms', format = 'mp4') {
  try {
    stats.totalDownloads += 1;
    const cleanPlatform = mapPlatformCategory(platformName);

    stats.recentEvents.push({
      type: 'download',
      platform: cleanPlatform,
      format,
      timestamp: new Date().toISOString()
    });

    persistStats();
  } catch (e) {
    console.error('[ANALYTICS DOWNLOAD ERROR]', e.message);
  }
}

function mapPlatformCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('youtube')) return 'YouTube';
  if (n.includes('instagram')) return 'Instagram';
  if (n.includes('tiktok')) return 'TikTok';
  if (n.includes('twitter') || n.includes('x.com')) return 'Twitter / X';
  if (n.includes('reddit')) return 'Reddit';
  if (n.includes('linkedin')) return 'LinkedIn';
  if (n.includes('facebook')) return 'Facebook';
  if (n.includes('vimeo')) return 'Vimeo';
  if (n.includes('adult') || n.includes('xvideos') || n.includes('spankbang') || n.includes('pornhub')) return 'Adult Platforms';
  return 'Other Web Platforms';
}

/**
 * Get formatted stats for UI dashboard
 */
export function getAnalyticsSummary() {
  const today = new Date().toISOString().split('T')[0];
  const todayVisits = stats.dailyVisits[today] || 0;
  const todayUniques = Array.isArray(stats.dailyUniqueVisitors[today]) ? stats.dailyUniqueVisitors[today].length : 0;

  // Build daily trend for past 7 days
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    last7Days.push({
      date: key,
      day: dayName,
      visits: stats.dailyVisits[key] || 0,
      uniques: Array.isArray(stats.dailyUniqueVisitors[key]) ? stats.dailyUniqueVisitors[key].length : 0
    });
  }

  return {
    totalVisits: stats.totalVisits,
    todayVisits,
    todayUniques,
    totalFetches: stats.totalFetches,
    totalDownloads: stats.totalDownloads,
    platformBreakdown: stats.platformBreakdown,
    weeklyTrend: last7Days,
    uptimeSeconds: Math.floor(process.uptime()),
    serverTime: new Date().toISOString()
  };
}
