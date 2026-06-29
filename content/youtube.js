/**
 * content/youtube.js  —  FocusTube v3
 * ─────────────────────────────────────────────────────────────
 * Runs inside YouTube. Handles:
 *   1. Focus Mode  — CSS class toggle on <html>
 *   2. Shorts Page — full block overlay on /shorts/* URLs
 *   3. Shorts Shelf — visible "Blocked" banner on homepage & channel pages
 *   4. Channel Allowlist — block overlay for non-allowed channels
 * ─────────────────────────────────────────────────────────────
 */

let focusModeEnabled = false;
let allowlist        = [];
let temporaryAllowed = [];
let channelOverlay   = null;
let shortsOverlay    = null;
let lastUrl          = location.href;
let shelfObserver    = null;

// ─── Safe back navigation ─────────────────────────────────────
// history.back() on YouTube's SPA can be a no-op when there is no prior
// history entry (e.g. user opened the video directly from a link).
// This helper detects that case and falls back to the YouTube homepage.
function goBack() {
  const blockedUrl = location.href;
  history.back();
  setTimeout(() => {
    // If the back action had no effect, send the user to YouTube home.
    if (location.href === blockedUrl || location.href === lastUrl) {
      location.replace('https://www.youtube.com/');
    }
  }, 500);
}

// ─── Boot ────────────────────────────────────────────────────
async function init() {
  try {
    const data       = await storageGet(['focusMode', 'allowlist']);
    focusModeEnabled = data.focusMode || false;
    allowlist        = data.allowlist || [];
    applyAll();
  } catch (e) {
    console.error('[FocusTube] init error:', e);
  }
}

// ─── Apply everything ─────────────────────────────────────────
function applyAll() {
  applyFocusMode();
  checkShortsPage();
  checkChannelAccess();
  if (focusModeEnabled) watchForNewShelves();
  else stopWatchingForShelves();
}

// ─── Messages from popup ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.action === 'focusModeChanged') {
      focusModeEnabled = msg.enabled;
      allowlist        = msg.allowlist || allowlist;
      applyAll();
    }
    if (msg.action === 'allowlistChanged') {
      allowlist      = msg.allowlist || [];
      channelOverlay = null; // allow re-evaluation
      checkChannelAccess();
    }
  } catch (e) {
    console.error('[FocusTube] message error:', e);
  }
  sendResponse({ ok: true });
});

// ─── SPA Navigation Watcher ──────────────────────────────────
const navObserverTarget = document.body || document.documentElement;
if (navObserverTarget) {
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl        = location.href;
      channelOverlay = null; // reset so overlay can re-evaluate on new page
      setTimeout(() => {
        try { applyAll(); } catch (e) { /* silent */ }
      }, 900);
    }
  }).observe(navObserverTarget, { subtree: true, childList: true });
}

// ─── 1. Focus Mode ────────────────────────────────────────────
function applyFocusMode() {
  const html = document.documentElement;
  if (focusModeEnabled) {
    html.classList.add('ft-focus-mode');
    blockAllShortsContent();
  } else {
    html.classList.remove('ft-focus-mode');
    restoreShortsShelf();
    removeChannelOverlay();
    removeShortsOverlay();
  }
}

// ─── 2. Shorts Page Block ─────────────────────────────────────
function checkShortsPage() {
  if (!focusModeEnabled) { removeShortsOverlay(); return; }
  if (location.pathname.startsWith('/shorts')) {
    showShortsOverlay();
  } else {
    removeShortsOverlay();
  }
}

function showShortsOverlay() {
  if (shortsOverlay) return;
  shortsOverlay = document.createElement('div');
  shortsOverlay.id = 'ft-shorts-overlay';
  shortsOverlay.innerHTML = `
    <div class="ft-box">
      <div class="ft-icon">🎬</div>
      <h2 class="ft-title">Shorts Blocked</h2>
      <p class="ft-msg">YouTube Shorts are blocked while <strong>Focus Mode</strong> is on.<br>Shorts are designed to keep you scrolling — stay on track!</p>
      <div class="ft-actions">
        <button id="ft-s-back" class="ft-btn ft-btn-sec">← Go Back</button>
        <button id="ft-s-home" class="ft-btn ft-btn-pri">📚 YouTube Home</button>
      </div>
    </div>`;
  document.body.appendChild(shortsOverlay);
  document.getElementById('ft-s-back')?.addEventListener('click', goBack);
  document.getElementById('ft-s-home')?.addEventListener('click', () => {
    location.replace('https://www.youtube.com/');
  });
}

function removeShortsOverlay() {
  if (shortsOverlay) { shortsOverlay.remove(); shortsOverlay = null; }
}

// ─── 3. Block ALL Shorts Content (shelves + channel tabs) ─────
function blockAllShortsContent() {
  if (!focusModeEnabled) return;
  // Block shorts shelf renderers (homepage, search, subscriptions)
  document.querySelectorAll(
    'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ' +
    'ytd-rich-shelf-renderer[feature-name="shorts"], ytd-shorts-shelf-renderer'
  ).forEach(shelf => {
    if (shelf.dataset.ftBlocked) return;
    shelf.dataset.ftBlocked = 'true';
    const banner = document.createElement('div');
    banner.className = 'ft-shelf-banner';
    banner.innerHTML = `<span>🔒</span><div><b>Shorts Blocked</b><br><small>Disabled in Focus Mode</small></div>`;
    shelf.prepend(banner);
  });

  // Hide the Shorts tab on channel pages
  document.querySelectorAll('yt-tab-shape, tp-yt-paper-tab').forEach(tab => {
    if (tab.textContent?.trim()?.toLowerCase() === 'shorts') {
      tab.style.display = 'none';
    }
  });
}

// Watch for dynamically injected shelves (YouTube loads content lazily)
function watchForNewShelves() {
  if (shelfObserver) return;
  shelfObserver = new MutationObserver(() => {
    if (focusModeEnabled) blockAllShortsContent();
  });
  shelfObserver.observe(document.body, { childList: true, subtree: true });
}

function stopWatchingForShelves() {
  if (shelfObserver) { shelfObserver.disconnect(); shelfObserver = null; }
}

function restoreShortsShelf() {
  document.querySelectorAll('[data-ft-blocked]').forEach(shelf => {
    shelf.removeAttribute('data-ft-blocked');
    shelf.querySelectorAll('.ft-shelf-banner').forEach(b => b.remove());
  });
  // Restore Shorts tabs on channel pages
  document.querySelectorAll('yt-tab-shape, tp-yt-paper-tab').forEach(tab => {
    if (tab.textContent?.trim()?.toLowerCase() === 'shorts') {
      tab.style.display = '';
    }
  });
}

// ─── 4. Channel Allowlist ─────────────────────────────────────
async function checkChannelAccess() {
  try {
    const path      = location.pathname;
    const isWatch   = path.startsWith('/watch');
    const isShort   = path.startsWith('/shorts/') && path.length > '/shorts/'.length;
    const isChannel = path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/');

    if (!isWatch && !isShort && !isChannel) { removeChannelOverlay(); return; }
    if (!focusModeEnabled || allowlist.length === 0) { removeChannelOverlay(); return; }

    const el = await waitForElement([
      '#channel-name a',
      'ytd-channel-name yt-formatted-string a',
      '#owner #channel-name a',
      '.ytd-video-owner-renderer #channel-name a',
      '#channel-header-container yt-formatted-string#text',
      'ytd-channel-name #text',
      '#text.ytd-channel-name',
    ], 5000);

    if (!el) return;

    const name = el.textContent.trim().toLowerCase();
    const href = el.href || location.href;

    if (temporaryAllowed.includes(name)) { removeChannelOverlay(); return; }

    const allowed = allowlist.some(entry => {
      const n = entry.toLowerCase().trim().replace(/^@/, '');
      return name.includes(n) || n.includes(name) || href.toLowerCase().includes(n);
    });

    if (allowed) {
      removeChannelOverlay();
    } else {
      showChannelOverlay(el.textContent.trim(), isShort, isChannel);
    }
  } catch (e) {
    console.error('[FocusTube] checkChannelAccess error:', e);
  }
}

function showChannelOverlay(channelName, isShort, isChannelPage) {
  if (channelOverlay) return;
  const msg = isShort
    ? "This channel's Shorts are also blocked."
    : isChannelPage
      ? 'This channel page is blocked in Focus Mode.'
      : 'This channel is not in your allowlist.';

  channelOverlay = document.createElement('div');
  channelOverlay.id = 'ft-block-overlay';
  channelOverlay.innerHTML = `
    <div class="ft-box">
      <div class="ft-icon">🔒</div>
      <h2 class="ft-title">Channel Blocked</h2>
      <p class="ft-channel">${escapeHtml(channelName)}</p>
      <p class="ft-msg">${escapeHtml(msg)}<br>Stay focused on your goals!</p>
      <div class="ft-actions">
        <button id="ft-c-back"  class="ft-btn ft-btn-sec">← Go Back</button>
        <button id="ft-c-allow" class="ft-btn ft-btn-pri">⏱ Allow Once</button>
      </div>
    </div>`;
  document.body.appendChild(channelOverlay);
  document.getElementById('ft-c-back')?.addEventListener('click', goBack);
  document.getElementById('ft-c-allow')?.addEventListener('click', () => {
    temporaryAllowed.push(channelName.toLowerCase().trim());
    removeChannelOverlay();
    checkChannelAccess();
  });
}

function removeChannelOverlay() {
  if (channelOverlay) { channelOverlay.remove(); channelOverlay = null; }
}

// ─── Helpers ─────────────────────────────────────────────────
function waitForElement(selectors, timeout = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    (function check() {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) return resolve(el);
      }
      if (Date.now() - start > timeout) return resolve(null);
      requestAnimationFrame(check);
    })();
  });
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
