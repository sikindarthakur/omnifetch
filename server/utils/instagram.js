import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { mediaInfoCache } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract Instagram Reel, Post, or Carousel with all photos and videos
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function extractInstagram(url) {
  return mediaInfoCache.getOrFetch(url, () => runInstagramExtract(url));
}

function runInstagramExtract(url) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'instagram_extractor.py');
    const proc = spawn('python3', [scriptPath, url]);

    let stdoutData = '';
    let stderrData = '';

    // 30 seconds timeout for Instagram extractor to fetch multi-photo carousels and reels
    const timeout = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
        reject(new Error('Instagram extraction timed out, proceeding to resilient fallback'));
      }
    }, 30000);

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to run Instagram extractor: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdoutData.trim()) {
        const err = stderrData.trim() || `Instagram extractor exited with code ${code}`;
        return reject(new Error(err));
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (!result.success) {
          return reject(new Error(result.error || 'Failed to extract Instagram media'));
        }

        // Structure standard downloader response
        const items = result.items || [];
        const isCarousel = result.isCarousel;
        const mainItem = items[0] || {};
        const isVideo = mainItem.type === 'video';

        // Prepare presets
        const presets = [];
        if (isVideo) {
          presets.push({
            id: 'insta_best_video',
            title: 'High Quality Instagram Video (MP4)',
            badge: 'Universal MP4',
            quality: 'HD Progressive',
            type: 'video',
            formatSelector: 'direct_stream',
            directUrl: mainItem.url,
            ext: 'mp4',
            approxSize: 'Original HD',
            isPreset: true,
            hasAudio: true,
            icon: 'sparkles'
          });
          presets.push({
            id: 'insta_audio_mp3',
            title: 'Extract Reel Audio (MP3)',
            badge: 'Audio Only',
            quality: 'High Quality MP3',
            type: 'audio',
            formatSelector: 'bestaudio/best',
            directUrl: mainItem.url,
            ext: 'mp3',
            approxSize: 'Audio Track',
            isPreset: true,
            hasAudio: true,
            icon: 'music'
          });
        } else {
          presets.push({
            id: 'insta_photo_hd',
            title: 'High Resolution Photo (JPG)',
            badge: 'Original HD',
            quality: 'Max Resolution',
            type: 'image',
            formatSelector: 'direct_stream',
            directUrl: mainItem.url,
            ext: 'jpg',
            approxSize: 'Original Photo',
            isPreset: true,
            hasAudio: false,
            icon: 'sparkles'
          });
        }

        resolve({
          id: result.shortcode,
          title: result.title || `Instagram Media (${result.uploader})`,
          description: '',
          thumbnail: result.thumbnail || mainItem.thumbnail,
          duration: 0,
          durationFormatted: isVideo ? 'Reel / Video' : 'Photo Post',
          uploader: `@${result.uploader}`,
          uploaderUrl: `https://www.instagram.com/${result.uploader}/`,
          viewCount: result.viewCount ? result.viewCount.toLocaleString() : null,
          likeCount: result.likeCount ? result.likeCount.toLocaleString() : null,
          webpageUrl: url,
          platform: result.platform,
          isCarousel: isCarousel,
          carouselItems: items,
          presets: presets,
          videoFormats: isVideo ? [
            {
              formatId: 'insta_video',
              formatSelector: 'direct_stream',
              directUrl: mainItem.url,
              height: 1080,
              width: 1920,
              resolution: '1080p / 720p HD',
              fps: 30,
              ext: 'mp4',
              vcodec: 'h264',
              acodec: 'aac',
              hasAudio: true,
              requiresMerge: false,
              sizeFormatted: 'Original File',
              rawSize: 0,
              fpsLabel: '',
              type: 'video'
            }
          ] : [],
          audioFormats: [],
          defaultDownload: presets[0]
        });
      } catch (err) {
        reject(new Error(`Failed to parse Instagram response: ${err.message}`));
      }
    });
  });
}
