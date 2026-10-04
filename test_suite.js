import { extractVideoInfo } from './server/utils/ytdlp.js';
import { scrapeMediaDirect } from './server/utils/generic_scraper.js';
import { sanitizeDownloadName, formatDuration, formatBytes, detectPlatform } from './server/utils/helpers.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runAllTests() {
  console.log('==================================================');
  console.log('🧪 RUNNING FULL ANY-VIDEO-DOWNLOADER TEST SUITE');
  console.log('==================================================');

  // TEST 1: Helper Functions
  console.log('\n[1] Testing Helper Functions:');
  assert(formatDuration(65) === '1:05', 'formatDuration(65) -> 1:05');
  assert(formatDuration(3665) === '1:01:05', 'formatDuration(3665) -> 1:01:05');
  assert(formatBytes(1048576) === '1 MB', 'formatBytes(1MB) -> 1 MB');
  assert(sanitizeDownloadName('Video: Episode #1 [1080p] / Test?*') === 'Video Episode #1 [1080p]  Test', 'sanitizeDownloadName removes invalid chars');
  
  const p1 = detectPlatform('https://www.youtube.com/watch?v=123');
  assert(p1.name === 'YouTube', 'detectPlatform YouTube');

  const p2 = detectPlatform('https://xhamster.com/videos/123');
  assert(p2.isAdult === true && p2.name === 'Adult Site', 'detectPlatform Adult Site');

  // TEST 2: yt-dlp Video Extraction (YouTube)
  console.log('\n[2] Testing yt-dlp Video Metadata Extraction (YouTube):');
  try {
    const ytData = await extractVideoInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert(ytData.title.includes('Rick Astley') || ytData.title.includes('Never Gonna Give You Up'), `Extracted title: ${ytData.title}`);
    assert(ytData.presets.length >= 2, `Generated ${ytData.presets.length} presets`);
    assert(ytData.videoFormats.length > 0, `Generated ${ytData.videoFormats.length} video formats`);
    assert(ytData.audioFormats.length > 0, `Generated ${ytData.audioFormats.length} audio formats`);
    assert(ytData.defaultDownload !== null, 'Has default download option');
  } catch (e) {
    assert(false, `YouTube extract threw error: ${e.message}`);
  }

  // TEST 3: yt-dlp Adult Site Extraction
  console.log('\n[3] Testing Adult Site Video Extraction (XHamster):');
  try {
    const adultData = await extractVideoInfo('https://xhamster.com/videos/i-went-to-chachi-room-because-her-husband-went-outside-and-we-share-single-bed-fuck-her-full-hindi-viral-video-xh6M4iy');
    assert(adultData.title.length > 0, `Adult video title extracted: ${adultData.title.substring(0, 40)}...`);
    assert(adultData.platform.isAdult === true, 'Platform flagged as isAdult');
    assert(adultData.videoFormats.length > 0, `Extracted ${adultData.videoFormats.length} video resolutions`);
    assert(adultData.presets.length > 0, `Extracted ${adultData.presets.length} quality presets`);
  } catch (e) {
    assert(false, `Adult extract threw error: ${e.message}`);
  }

  // TEST 4: Fallback Scraper Video Filtering (No thumbnail spam on video pages)
  console.log('\n[4] Testing Scraper Fallback on Video Pages:');
  try {
    const scraped = await scrapeMediaDirect('https://xhamster.com/videos/i-went-to-chachi-room-because-her-husband-went-outside-and-we-share-single-bed-fuck-her-full-hindi-viral-video-xh6M4iy');
    assert(scraped.isCarousel === false, 'Video page correctly did NOT generate an image carousel from sidebar thumbnails');
    assert(scraped.presets.length > 0, 'Generated video presets');
  } catch (e) {
    console.log(`  ℹ️ Scraper handled video page: ${e.message}`);
  }

  // TEST 5: Cache Functionality
  console.log('\n[5] Testing Media Cache deduplication:');
  const t0 = Date.now();
  const cachedYt = await extractVideoInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const t1 = Date.now();
  assert(cachedYt.title.length > 0 && (t1 - t0) < 50, `Cache returned result in ${t1 - t0}ms`);

  console.log('\n==================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
