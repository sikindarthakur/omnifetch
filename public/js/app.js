import { showToast, renderMetadata } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('url-input');
  const btnFetch = document.getElementById('btn-fetch');
  const btnPaste = document.getElementById('btn-paste');
  const btnClear = document.getElementById('btn-clear');
  const loadingBox = document.getElementById('loading-box');
  const resultSection = document.getElementById('result-section');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const inputCardWrapper = document.getElementById('input-card-wrapper');
  const modeBtnStandard = document.getElementById('mode-btn-standard');
  const modeBtnAdult = document.getElementById('mode-btn-adult');
  const adultBadgeTag = document.getElementById('adult-badge-tag');

  // Mode state: 'standard' | 'adult'
  let currentMode = 'standard';
  let pendingAdultUrl = null;

  // Initialize Components
  initModeSwitcher();
  initCookieConsent();
  initModals();
  initAgeGate();

  // Input change & clear button handler
  urlInput.addEventListener('input', () => {
    btnClear.style.display = urlInput.value ? 'flex' : 'none';
  });

  btnClear.addEventListener('click', () => {
    urlInput.value = '';
    btnClear.style.display = 'none';
    urlInput.focus();
  });

  // Mode Switcher Handler
  function initModeSwitcher() {
    const isVerified = sessionStorage.getItem('omnifetch_age_verified') === 'true';
    if (isVerified && adultBadgeTag) {
      adultBadgeTag.textContent = '18+ Ready';
    }

    if (modeBtnStandard) {
      modeBtnStandard.addEventListener('click', () => {
        setMediaMode('standard');
      });
    }

    if (modeBtnAdult) {
      modeBtnAdult.addEventListener('click', () => {
        const verified = sessionStorage.getItem('omnifetch_age_verified') === 'true';
        if (!verified) {
          // Open Age Gate Modal to agree to Terms before activating
          openModal('modal-age-gate');
        } else {
          setMediaMode(currentMode === 'adult' ? 'standard' : 'adult');
        }
      });
    }
  }

  function setMediaMode(mode, autoPaste = true) {
    currentMode = mode;

    if (mode === 'adult') {
      if (inputCardWrapper) inputCardWrapper.classList.add('adult-mode-active');
      if (modeBtnAdult) modeBtnAdult.classList.add('active');
      if (modeBtnStandard) modeBtnStandard.classList.remove('active');
      if (adultBadgeTag) adultBadgeTag.textContent = 'Active (18+)';
      
      urlInput.placeholder = '🔞 Paste 18+ adult link (e.g. XVideos, SpankBang, Pornhub, XNXX)...';
      btnPaste.title = 'Paste 18+ adult link from clipboard';
      
      showToast('🔞 18+ Adult Mode Active! Paste button unlocked for adult links.', 'success', 3500);

      if (autoPaste && navigator.clipboard) {
        // Try automatic paste if input is currently empty
        if (!urlInput.value.trim()) {
          navigator.clipboard.readText().then((text) => {
            if (text && isValidUrl(text.trim()) && isAdultMatch(text.trim())) {
              urlInput.value = text.trim();
              btnClear.style.display = 'flex';
              showToast('18+ Link pasted automatically!', 'info');
              handleFetchVideo();
            } else {
              urlInput.focus();
            }
          }).catch(() => {
            urlInput.focus();
          });
        }
      } else {
        urlInput.focus();
      }
    } else {
      if (inputCardWrapper) inputCardWrapper.classList.remove('adult-mode-active');
      if (modeBtnStandard) modeBtnStandard.classList.add('active');
      if (modeBtnAdult) modeBtnAdult.classList.remove('active');
      
      const isVerified = sessionStorage.getItem('omnifetch_age_verified') === 'true';
      if (adultBadgeTag) adultBadgeTag.textContent = isVerified ? '18+ Ready' : 'Click to Unlock';
      
      urlInput.placeholder = 'Paste any media link here...';
      btnPaste.title = 'Paste media link from clipboard';
      urlInput.focus();
    }
  }

  // 1-Click Clipboard Paste
  btnPaste.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard) {
        showToast('Clipboard API not supported in your browser. Please paste manually.', 'error');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text) {
        const trimmed = text.trim();
        urlInput.value = trimmed;
        btnClear.style.display = 'flex';

        // Check if pasted link is an adult link and age is not verified
        const isAdult = isAdultMatch(trimmed);
        const isVerified = sessionStorage.getItem('omnifetch_age_verified') === 'true';

        if (isAdult && !isVerified) {
          pendingAdultUrl = trimmed;
          openModal('modal-age-gate');
          showToast('🔞 Adult site link detected. Please agree to Terms & Age Gate to proceed.', 'info', 4500);
          return;
        }

        if (isAdult && isVerified && currentMode !== 'adult') {
          setMediaMode('adult', false);
        }

        showToast('Link pasted from clipboard!', 'info');
        if (isValidUrl(trimmed)) {
          handleFetchVideo();
        }
      } else {
        showToast('Clipboard is empty.', 'info');
      }
    } catch (err) {
      showToast('Could not read clipboard. Please paste manually (Ctrl+V).', 'info');
    }
  });

  // Enter key in input triggers download
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFetchVideo();
    }
  });

  // Fetch button trigger
  btnFetch.addEventListener('click', handleFetchVideo);

  // Tabs switching
  tabBtns.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabBtns.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const targetTab = tab.getAttribute('data-tab');
      document.querySelectorAll('.format-list-tab').forEach((list) => {
        list.style.display = 'none';
      });

      const activeList = document.getElementById(`list-${targetTab}`);
      if (activeList) {
        activeList.style.display = 'grid';
      }
    });
  });

  // Main fetch function
  async function handleFetchVideo() {
    const rawUrl = urlInput.value.trim();

    if (!rawUrl) {
      showToast('Please enter or paste a media link first.', 'error');
      urlInput.focus();
      return;
    }

    if (!isValidUrl(rawUrl)) {
      showToast('Please enter a valid URL starting with http:// or https://', 'error');
      return;
    }

    const isAdult = isAdultMatch(rawUrl);
    const isAgeVerified = sessionStorage.getItem('omnifetch_age_verified') === 'true';

    // Intercept adult links before sending request if age not verified
    if (isAdult && !isAgeVerified) {
      pendingAdultUrl = rawUrl;
      openModal('modal-age-gate');
      showToast('🔞 Adult content link. Please agree to terms & verify age first.', 'info', 5000);
      return;
    }

    if (isAdult && isAgeVerified && currentMode !== 'adult') {
      setMediaMode('adult', false);
    }

    // Set Loading State
    btnFetch.disabled = true;
    btnFetch.innerHTML = `
      <div class="spinner" style="width: 18px; height: 18px; margin: 0; border-width: 2px;"></div>
      <span>Analyzing...</span>
    `;

    resultSection.style.display = 'none';
    loadingBox.style.display = 'block';

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: rawUrl })
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to extract media details.');
      }

      // Secondary check from server metadata
      const isServerAdult = 
        resData.data.platform?.isAdult === true || 
        isAdultMatch(resData.data.webpageUrl) ||
        isAdultMatch(resData.data.title) ||
        isAdultMatch(resData.data.uploader);

      if (isServerAdult && !sessionStorage.getItem('omnifetch_age_verified')) {
        loadingBox.style.display = 'none';
        pendingAdultUrl = rawUrl;
        openModal('modal-age-gate');
        return;
      }

      showToast('Media details extracted successfully!', 'success');
      renderMetadata(resData.data, rawUrl);
    } catch (error) {
      console.error(error);
      loadingBox.style.display = 'none';
      showToast(error.message || 'Error fetching media. Please check the URL.', 'error', 6000);
    } finally {
      btnFetch.disabled = false;
      btnFetch.innerHTML = `
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        <span>Fetch Media</span>
      `;
    }
  }

  function isAdultMatch(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    const adultKeywords = [
      'xhamster', 'pornhub', 'xvideos', 'xnxx', 'redtube', 'youporn', 'spankbang',
      'eporner', 'hqporner', 'tube8', 'brazzers', 'tnaflix', 'drtuber', 'nuvid',
      'beeg', 'fuq', 'jav', 'hentai', 'nhentai', 'rule34', 'erome', 'daftsex',
      'thumbzilla', 'stripchat', 'chaturbate', 'camsoda', 'bongacams', 'cam4',
      'porn', 'xxx', 'nsfw', 'adult', 'sex'
    ];
    return adultKeywords.some(kw => lower.includes(kw));
  }

  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  // 18+ Age Gate & Terms Agreement Handlers
  function initAgeGate() {
    const confirmBtn = document.getElementById('btn-age-confirm');
    const cancelBtn = document.getElementById('btn-age-cancel');
    const termsLinkInline = document.getElementById('link-modal-terms-inline');

    if (termsLinkInline) {
      termsLinkInline.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('modal-terms');
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        sessionStorage.setItem('omnifetch_age_verified', 'true');
        closeModal('modal-age-gate');

        // Activate 18+ Adult Mode
        setMediaMode('adult', false);

        if (pendingAdultUrl) {
          urlInput.value = pendingAdultUrl;
          btnClear.style.display = 'flex';
          showToast('18+ Terms Agreed. Fetching adult media...', 'success');
          handleFetchVideo();
          pendingAdultUrl = null;
        } else {
          showToast('🔞 18+ Adult Mode Unlocked! Paste your adult link now.', 'success', 4000);
          urlInput.focus();
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        pendingAdultUrl = null;
        closeModal('modal-age-gate');
        setMediaMode('standard', false);
        urlInput.value = '';
        btnClear.style.display = 'none';
        showToast('18+ Adult Mode was not activated.', 'info', 4000);
      });
    }
  }

  // Modals Handling
  function initModals() {
    const modalTriggers = {
      'link-privacy': 'modal-privacy',
      'link-terms': 'modal-terms',
      'link-dmca': 'modal-dmca',
      'link-supported': 'modal-supported'
    };

    Object.entries(modalTriggers).forEach(([btnId, modalId]) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          openModal(modalId);
        });
      }
    });

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    // Close on clicking backdrop
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove('active');
          if (backdrop.id === 'modal-age-gate' && pendingAdultUrl) {
            pendingAdultUrl = null;
          }
        }
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.active').forEach((modal) => {
          modal.classList.remove('active');
        });
        if (pendingAdultUrl) {
          pendingAdultUrl = null;
        }
      }
    });
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }

  // Cookie Consent initialization
  function initCookieConsent() {
    const banner = document.getElementById('cookie-banner');
    const acceptBtn = document.getElementById('btn-cookie-accept');
    const privacyBtn = document.getElementById('btn-cookie-privacy');

    if (banner && !localStorage.getItem('omnifetch_cookie_consent')) {
      setTimeout(() => {
        banner.style.display = 'flex';
      }, 1000);
    }

    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        localStorage.setItem('omnifetch_cookie_consent', 'true');
        if (banner) banner.style.display = 'none';
        showToast('Privacy preferences saved.', 'info', 2500);
      });
    }

    if (privacyBtn) {
      privacyBtn.addEventListener('click', () => {
        openModal('modal-privacy');
      });
    }
  }
});
