import express from 'express';
import { extractVideoInfo } from '../utils/ytdlp.js';
import { extractInstagram } from '../utils/instagram.js';
import { extractLinkedIn } from '../utils/linkedin.js';
import { scrapeMediaDirect } from '../utils/generic_scraper.js';
import { recordFetch } from '../utils/analytics.js';

const router = express.Router();

/**
 * POST /api/info
 * Request body: { url: "https://..." }
 */
router.post('/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid URL.'
      });
    }

    const trimmedUrl = url.trim();

    // URL format validation
    try {
      new URL(trimmedUrl);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'The URL provided is not a valid web URL format.'
      });
    }

    console.log(`[INFO REQUEST] Processing URL: ${trimmedUrl}`);

    const isInstagram = trimmedUrl.includes('instagram.com/reel/') ||
                        trimmedUrl.includes('instagram.com/p/') ||
                        trimmedUrl.includes('instagram.com/tv/') ||
                        trimmedUrl.includes('instagram.com/share/');

    const isLinkedIn = trimmedUrl.includes('linkedin.com/posts/') ||
                       trimmedUrl.includes('linkedin.com/feed/update/') ||
                       trimmedUrl.includes('linkedin.com/embed/');

    // 1. Instagram Dedicated Handler (Reels, Single Posts & Carousels)
    if (isInstagram) {
      try {
        console.log(`[INSTAGRAM EXTRACTOR] Fetching Instagram media...`);
        const instaData = await extractInstagram(trimmedUrl);
        recordFetch('Instagram', trimmedUrl);
        return res.json({
          success: true,
          data: instaData
        });
      } catch (instaErr) {
        console.warn(`[INSTAGRAM EXTRACTOR WARNING] Fallback: ${instaErr.message}`);
      }
    }

    // 2. LinkedIn Dedicated Handler (Videos, Single Photos & Multi-Image Document Carousels)
    if (isLinkedIn) {
      try {
        console.log(`[LINKEDIN EXTRACTOR] Fetching LinkedIn media...`);
        const linkedinData = await extractLinkedIn(trimmedUrl);
        recordFetch('LinkedIn', trimmedUrl);
        return res.json({
          success: true,
          data: linkedinData
        });
      } catch (linkedinErr) {
        console.warn(`[LINKEDIN EXTRACTOR WARNING] Fallback: ${linkedinErr.message}`);
      }
    }

    // 3. Primary Extractor (yt-dlp)
    try {
      const metadata = await extractVideoInfo(trimmedUrl);
      recordFetch(metadata.platform?.name || 'Web Video', trimmedUrl);
      return res.json({
        success: true,
        data: metadata
      });
    } catch (ytdlpError) {
      console.warn(`[YTDLP EXTRACTOR FAILED] Trying generic web scraper fallback: ${ytdlpError.message}`);
      
      // 4. Resilient Universal Dynamic Scraper (Flashvars, Adult Sites, Twitter/Reddit Images, Generic HTML5 Galleries)
      try {
        const scrapedData = await scrapeMediaDirect(trimmedUrl);
        recordFetch(scrapedData.platform?.name || 'Web Video', trimmedUrl);
        return res.json({
          success: true,
          data: scrapedData
        });
      } catch (scrapeError) {
        console.error(`[SCRAPER FALLBACK FAILED] ${scrapeError.message}`);
        let displayError = ytdlpError.message || scrapeError.message;
        if (displayError.includes("Sign in to confirm you're not a bot") || displayError.includes('bot')) {
          displayError = "YouTube is requesting bot verification on this server IP. To fix this, provide cookies via the YOUTUBE_COOKIES environment variable in your server dashboard or add a cookies.txt file.";
        }
        return res.status(500).json({
          success: false,
          error: displayError
        });
      }
    }
  } catch (error) {
    console.error(`[INFO ERROR] ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to extract media from this URL.'
    });
  }
});

export default router;
