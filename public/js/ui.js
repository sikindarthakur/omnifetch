/**
 * UI Management Module - Enhanced with Accelerated Feedback & Visual States
 */

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#10b981"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#ef4444"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
  } else {
    iconSvg = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#6366f1"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  }

  toast.innerHTML = `
    <span>${iconSvg}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function buildDownloadUrl(originalUrl, formatSelector, ext, title, isAudio = false, directUrl = null) {
  const params = new URLSearchParams({
    url: originalUrl || '',
    format: formatSelector || 'best',
    ext: ext || 'mp4',
    title: title || 'media',
    isAudio: isAudio ? 'true' : 'false'
  });
  if (directUrl) {
    params.set('directUrl', directUrl);
  }
  return `/api/download?${params.toString()}`;
}

function handleDownloadButtonClick(btn, label = 'Download', toastMsg = 'Starting accelerated download...') {
  const originalHtml = btn.innerHTML;
  btn.classList.add('downloading');
  btn.innerHTML = `
    <div class="spinner" style="width: 14px; height: 14px; margin: 0; border-width: 2px;"></div>
    <span>Starting...</span>
  `;
  showToast(toastMsg, 'success', 3500);

  setTimeout(() => {
    btn.classList.remove('downloading');
    btn.innerHTML = originalHtml;
  }, 3500);
}

export function renderMetadata(data, originalUrl) {
  const resultSection = document.getElementById('result-section');
  const loadingBox = document.getElementById('loading-box');

  loadingBox.style.display = 'none';
  resultSection.style.display = 'block';

  // Populate overview
  const thumbnailEl = document.getElementById('video-thumbnail');
  const durationEl = document.getElementById('video-duration');
  const platformEl = document.getElementById('video-platform-tag');
  const titleEl = document.getElementById('video-title');
  const uploaderEl = document.getElementById('video-uploader');
  const viewsEl = document.getElementById('video-views');
  const instantBtn = document.getElementById('btn-instant-download');
  const carouselContainer = document.getElementById('carousel-section');

  thumbnailEl.src = data.thumbnail || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60';
  thumbnailEl.alt = data.title;
  durationEl.textContent = data.durationFormatted || (data.isCarousel ? `${data.itemCount || data.carouselItems?.length} items` : 'Media');
  
  platformEl.textContent = data.platform?.name || 'Video';
  platformEl.style.backgroundColor = data.platform?.color || '#6366F1';

  titleEl.textContent = data.title;
  titleEl.title = data.title;
  
  uploaderEl.textContent = data.uploader || 'Creator';
  viewsEl.textContent = data.viewCount ? `${data.viewCount} views` : (data.isCarousel ? `${data.carouselItems?.length} photos & videos` : 'Ready to download');

  // Setup Instant Best Quality Download
  const defaultOption = data.defaultDownload || data.presets?.[0];
  if (defaultOption) {
    instantBtn.href = buildDownloadUrl(originalUrl, defaultOption.formatSelector, defaultOption.ext, data.title, false, defaultOption.directUrl);
    instantBtn.onclick = (e) => {
      handleDownloadButtonClick(instantBtn, 'Instant Download', '⚡ Starting high-speed media download...');
    };
  }

  // Handle Multi-Item Carousel Album
  if (data.isCarousel && data.carouselItems && data.carouselItems.length > 0) {
    if (carouselContainer) {
      carouselContainer.style.display = 'block';
      renderCarouselGallery(data.carouselItems, originalUrl, data.title);
    }
  } else {
    if (carouselContainer) {
      carouselContainer.style.display = 'none';
    }
  }

  // Update tabs counters
  document.getElementById('count-presets').textContent = data.presets?.length || 0;
  document.getElementById('count-videos').textContent = data.videoFormats?.length || 0;
  document.getElementById('count-audios').textContent = data.audioFormats?.length || 0;

  // Render tab contents
  renderPresets(data.presets || [], originalUrl, data.title);
  renderVideoList(data.videoFormats || [], originalUrl, data.title);
  renderAudioList(data.audioFormats || [], originalUrl, data.title);

  // Smooth scroll down to result card
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCarouselGallery(items, originalUrl, title) {
  const galleryGrid = document.getElementById('carousel-grid');
  const countBadge = document.getElementById('carousel-count-badge');
  const zipBtn = document.getElementById('btn-download-all-zip');

  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';
  if (countBadge) countBadge.textContent = `${items.length} Photos & Videos`;

  if (zipBtn) {
    zipBtn.href = `/api/download-zip?url=${encodeURIComponent(originalUrl)}&title=${encodeURIComponent(title)}`;
    zipBtn.onclick = () => {
      handleDownloadButtonClick(zipBtn, 'Download All in ZIP', `📦 Packaging all ${items.length} photos and videos into ZIP...`);
    };
  }

  items.forEach((item) => {
    const isVid = item.type === 'video';
    const downloadLink = buildDownloadUrl(originalUrl, 'direct_stream', item.ext, `${title}_item_${item.index}`, false, item.url);

    const card = document.createElement('div');
    card.className = 'carousel-item-card';
    card.innerHTML = `
      <div class="carousel-item-thumb-wrapper">
        <img src="${item.thumbnail || item.url}" alt="Item ${item.index}" class="carousel-item-thumb" loading="lazy" />
        <span class="carousel-item-type-badge ${isVid ? 'video' : 'photo'}">
          ${isVid 
            ? `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Video #${item.index}`
            : `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> Photo #${item.index}`
          }
        </span>
      </div>
      <div class="carousel-item-body">
        <div class="carousel-item-title">${isVid ? 'HD Video (MP4)' : 'HD Photo (JPG)'}</div>
        <a href="${downloadLink}" class="btn-carousel-download" download>
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download
        </a>
      </div>
    `;

    const btn = card.querySelector('.btn-carousel-download');
    btn.addEventListener('click', () => {
      handleDownloadButtonClick(btn, 'Download', `⚡ Downloading ${isVid ? 'Video' : 'Photo'} #${item.index}...`);
    });

    galleryGrid.appendChild(card);
  });
}

function renderPresets(presets, originalUrl, title) {
  const container = document.getElementById('list-presets');
  container.innerHTML = '';

  if (!presets || presets.length === 0) {
    container.innerHTML = '<div class="format-subtext" style="padding: 18px; text-align: center;">No presets available. Check direct formats below.</div>';
    return;
  }

  presets.forEach((item) => {
    const isAudio = item.type === 'audio';
    const downloadLink = buildDownloadUrl(originalUrl, item.formatSelector, item.ext, title, isAudio, item.directUrl);

    const badgeClass = item.quality?.includes('1080') ? 'fhd' : (item.quality?.includes('4K') || item.quality?.includes('Auto Max')) ? 'uhd' : isAudio ? 'audio-badge' : 'fhd';

    const div = document.createElement('div');
    div.className = 'format-item';
    div.innerHTML = `
      <div class="format-info-left">
        <div class="format-icon-box ${isAudio ? 'audio' : ''}">
          ${isAudio 
            ? `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>`
            : `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`
          }
        </div>
        <div>
          <div class="format-meta-title">
            <span>${item.title}</span>
            <span class="format-badge ${badgeClass}">${item.badge || item.ext.toUpperCase()}</span>
          </div>
          <div class="format-subtext">
            <span>Format: <strong>${item.ext.toUpperCase()}</strong></span>
            <span>•</span>
            <span>${item.quality}</span>
            <span>•</span>
            <span>Universal Compatibility ✅</span>
          </div>
        </div>
      </div>
      <div class="format-actions">
        <span class="format-size">${item.approxSize}</span>
        <a href="${downloadLink}" class="btn-download-item" download>
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download
        </a>
      </div>
    `;

    const btn = div.querySelector('.btn-download-item');
    btn.addEventListener('click', () => {
      handleDownloadButtonClick(btn, 'Download', `⚡ Initiating high-speed download: ${item.title}`);
    });

    container.appendChild(div);
  });
}

function renderVideoList(formats, originalUrl, title) {
  const container = document.getElementById('list-videos');
  container.innerHTML = '';

  if (!formats || formats.length === 0) {
    container.innerHTML = '<div class="format-subtext" style="padding: 20px; text-align: center;">No separate video streams listed. Use the Presets tab or Carousel grid above.</div>';
    return;
  }

  formats.forEach((fmt) => {
    const downloadLink = buildDownloadUrl(originalUrl, fmt.formatSelector, fmt.ext, title, false, fmt.directUrl);
    const isFhd = fmt.height >= 1080;
    const isUhd = fmt.height >= 1440;

    const div = document.createElement('div');
    div.className = 'format-item';
    div.innerHTML = `
      <div class="format-info-left">
        <div class="format-icon-box">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        </div>
        <div>
          <div class="format-meta-title">
            <span>${fmt.resolution} (${fmt.ext.toUpperCase()})</span>
            ${isUhd ? '<span class="format-badge uhd">Ultra HD</span>' : isFhd ? '<span class="format-badge fhd">Full HD</span>' : ''}
            ${fmt.fpsLabel ? `<span class="format-badge" style="background: rgba(255,255,255,0.1); color: #fff;">${fmt.fpsLabel}</span>` : ''}
          </div>
          <div class="format-subtext">
            <span>Video Codec: ${fmt.vcodec ? fmt.vcodec.split('.')[0] : 'Universal H.264'}</span>
            <span>•</span>
            <span>Merged with Studio Audio</span>
          </div>
        </div>
      </div>
      <div class="format-actions">
        <span class="format-size">${fmt.sizeFormatted}</span>
        <a href="${downloadLink}" class="btn-download-item" download>
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download
        </a>
      </div>
    `;

    const btn = div.querySelector('.btn-download-item');
    btn.addEventListener('click', () => {
      handleDownloadButtonClick(btn, 'Download', `⚡ Downloading video in ${fmt.resolution}...`);
    });

    container.appendChild(div);
  });
}

function renderAudioList(formats, originalUrl, title) {
  const container = document.getElementById('list-audios');
  container.innerHTML = '';

  if (!formats || formats.length === 0) {
    container.innerHTML = '<div class="format-subtext" style="padding: 20px; text-align: center;">Use the Preset MP3 option in Presets tab for studio audio extraction.</div>';
    return;
  }

  formats.forEach((fmt) => {
    const downloadLink = buildDownloadUrl(originalUrl, fmt.formatSelector, fmt.ext, title, true, fmt.directUrl);

    const div = document.createElement('div');
    div.className = 'format-item';
    div.innerHTML = `
      <div class="format-info-left">
        <div class="format-icon-box audio">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
        </div>
        <div>
          <div class="format-meta-title">
            <span>Audio Stream (${fmt.ext.toUpperCase()})</span>
            <span class="format-badge audio-badge">${fmt.quality}</span>
          </div>
          <div class="format-subtext">
            <span>Audio Codec: ${fmt.acodec || 'Original Audio'}</span>
            <span>•</span>
            <span>Lossless / Direct Audio Stream</span>
          </div>
        </div>
      </div>
      <div class="format-actions">
        <span class="format-size">${fmt.sizeFormatted}</span>
        <a href="${downloadLink}" class="btn-download-item" download>
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download Audio
        </a>
      </div>
    `;

    const btn = div.querySelector('.btn-download-item');
    btn.addEventListener('click', () => {
      handleDownloadButtonClick(btn, 'Download Audio', `🎵 Extracting audio stream (${fmt.quality})...`);
    });

    container.appendChild(div);
  });
}
