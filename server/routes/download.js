import express from 'express';
import { createRequire } from 'module';
import { streamVideoDownload } from '../utils/ytdlp.js';
import { sanitizeDownloadName } from '../utils/helpers.js';
import { extractInstagram } from '../utils/instagram.js';
import { extractLinkedIn } from '../utils/linkedin.js';
import { scrapeMediaDirect } from '../utils/generic_scraper.js';
import { recordDownload } from '../utils/analytics.js';
import { mediaInfoCache } from '../utils/cache.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const router = express.Router();

function safeDecode(val, fallback = '') {
  if (!val || typeof val !== 'string') return fallback;
  try {
    return val.includes('%') ? decodeURIComponent(val) : val;
  } catch (_) {
    return val;
  }
}

/**
 * GET /api/download
 * Query parameters:
 *  - url: encoded target URL
 *  - directUrl: direct CDN media URL
 *  - format: format selector (e.g. "bestvideo+bestaudio/best")
 *  - ext: file extension (e.g. "mp4", "mp3", "jpg", "png", "webm")
 *  - title: video title for filename
 *  - isAudio: boolean flag for audio-only extraction
 */
router.get('/download', (req, res) => {
  try {
    const { url, directUrl, format, ext, title, isAudio } = req.query;

    if (!url && !directUrl) {
      return res.status(400).send('Missing media URL parameter.');
    }

    const decodedUrl = url ? safeDecode(url) : '';
    const decodedDirectUrl = directUrl ? safeDecode(directUrl) : null;
    const formatSelector = format ? safeDecode(format) : 'best';
    const extension = (ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
    const videoTitle = title ? safeDecode(title, 'downloaded_media') : 'downloaded_media';
    const isAudioOnly = isAudio === 'true' || isAudio === '1' || extension === 'mp3' || extension === 'm4a';

    // Record download event
    recordDownload(decodedUrl || decodedDirectUrl || 'Direct Media', extension);

    streamVideoDownload(
      {
        url: decodedUrl,
        directUrl: decodedDirectUrl,
        formatSelector,
        ext: extension,
        title: videoTitle,
        isAudioOnly
      },
      res
    );
  } catch (error) {
    console.error(`[DOWNLOAD ROUTE ERROR]: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).send(`Download initialization failed: ${error.message}`);
    }
  }
});

/**
 * GET /api/download-zip
 * Universal High-Speed Batch ZIP Downloader
 */
router.get('/download-zip', async (req, res) => {
  try {
    const { url, title } = req.query;
    if (!url) {
      return res.status(400).send('Missing URL parameter for zip download.');
    }

    const decodedUrl = safeDecode(url);
    const postTitle = title ? sanitizeDownloadName(safeDecode(title), 'media_album') : 'media_album';

    console.log(`[ZIP DOWNLOAD] Starting accelerated batch download for: ${decodedUrl}`);

    // Check cache first for instant metadata
    let mediaData = mediaInfoCache.get(`insta_${decodedUrl}`) ||
                    mediaInfoCache.get(`linkedin_${decodedUrl}`) ||
                    mediaInfoCache.get(`scrape_${decodedUrl}`) ||
                    mediaInfoCache.get(`ytdlp_${decodedUrl}`) ||
                    mediaInfoCache.get(decodedUrl);

    if (!mediaData) {
      if (decodedUrl.includes('instagram.com/')) {
        mediaData = await extractInstagram(decodedUrl);
      } else if (decodedUrl.includes('linkedin.com/')) {
        mediaData = await extractLinkedIn(decodedUrl);
      } else {
        mediaData = await scrapeMediaDirect(decodedUrl);
      }
    }

    if (!mediaData || !mediaData.carouselItems || mediaData.carouselItems.length === 0) {
      return res.status(404).send('No carousel or album items found to zip.');
    }

    const zipFilename = `${postTitle}.zip`;
    recordDownload(decodedUrl || 'Carousel Album', 'zip');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFilename)}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);
    res.setHeader('Cache-Control', 'no-cache');

    // Store mode (zlib level 0) avoids re-compressing already compressed JPGs/MP4s, speeding up zip creation 10x!
    const archive = archiver('zip', {
      zlib: { level: 0 },
      forceLocalTime: true
    });
    archive.pipe(res);

    archive.on('error', (err) => {
      console.error('[ARCHIVE ERROR]', err);
      if (!res.headersSent) res.status(500).send(`Archiving failed: ${err.message}`);
    });

    // Fetch up to 6 items concurrently for rapid batch packaging
    const items = mediaData.carouselItems;
    const concurrency = 6;
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (item) => {
          const mediaUrl = item.url;
          const itemName = `${item.title || `item_${item.index}`}.${item.ext || 'jpg'}`;

          try {
            const itemResponse = await fetch(mediaUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
              }
            });

            if (itemResponse.ok) {
              const arrayBuffer = await itemResponse.arrayBuffer();
              archive.append(Buffer.from(arrayBuffer), { name: itemName });
            }
          } catch (e) {
            console.warn(`[ZIP ITEM SKIP] Failed to fetch item ${item.index}: ${e.message}`);
          }
        })
      );
    }

    await archive.finalize();
    console.log(`[ZIP DOWNLOAD COMPLETED] ${zipFilename}`);
  } catch (error) {
    console.error(`[ZIP ROUTE ERROR] ${error.message}`);
    if (!res.headersSent) {
      res.status(500).send(`Failed to generate ZIP: ${error.message}`);
    }
  }
});

export default router;
