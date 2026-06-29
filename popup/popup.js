/**
 * popup/popup.js  —  FocusTube v3
 * ─────────────────────────────────────────────────────────────
 * UI controller for the FocusTube popup.
 * - Polls the service worker every 500ms for fresh timer state.
 * - Sends commands: startTimer, pauseTimer, resetTimer.
 * - Manages focus toggle and channel allowlist.
 * - Shows a random motivational quote on each open.
 * ─────────────────────────────────────────────────────────────
 */

// ─── Motivational Quotes ─────────────────────────────────────
const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Banksy" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Dream it. Wish it. Do it.", author: "Unknown" },
  { text: "Wake up with determination. Go to bed with satisfaction.", author: "Unknown" },
  { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" },
  { text: "It's going to be hard, but hard does not mean impossible.", author: "Unknown" },
  { text: "Don't wait for opportunity. Create it.", author: "Unknown" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "No pressure, no diamonds.", author: "Thomas Carlyle" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "All progress takes place outside the comfort zone.", author: "Michael John Bobak" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { text: "You become what you believe.", author: "Oprah Winfrey" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Gandhi" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "The beautiful thing about learning is nobody can take it away from you.", author: "B.B. King" },
  { text: "Study hard what interests you the most in the most undisciplined way.", author: "Richard Feynman" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert T. Kiyosaki" },
];

// ─── Constants ────────────────────────────────────────────────
const STUDY_DURATION = 25 * 60;
const BREAK_DURATION =  5 * 60;
const CIRCUMFERENCE  = 326.73; // 2 * π * 52

// ─── DOM refs ─────────────────────────────────────────────────
const quoteText     = document.getElementById('quote-text');
const quoteAuthor   = document.getElementById('quote-author');
const quoteRefresh  = document.getElementById('quote-refresh');
const sessionBadge  = document.getElementById('session-badge');
const timerTime     = document.getElementById('timer-time');
const timerLabel    = document.getElementById('timer-label');
const ringProgress  = document.getElementById('ring-progress');
const btnStart      = document.getElementById('btn-start');
const btnStartText  = document.getElementById('btn-start-text');
const playIcon      = document.getElementById('play-icon');
const btnReset      = document.getElementById('btn-reset');
const btnSkip       = document.getElementById('btn-skip');
const focusToggle   = document.getElementById('focus-toggle');
const channelInput  = document.getElementById('channel-input');
const btnAddChannel = document.getElementById('btn-add-channel');
const channelList   = document.getElementById('channel-list');
const statTime      = document.getElementById('stat-time');
const statPomodoros = document.getElementById('stat-pomodoros');
const toastEl       = document.getElementById('ft-toast');

// ─── State ────────────────────────────────────────────────────
let isRunning     = false;
let currentMode   = 'study';
let allowlist     = [];
let pollInterval  = null;
let lastKnownMode = 'study';
let toastTimer    = null;

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  showRandomQuote();
  await loadAllowlist();
  await loadFocusMode();
  await refreshState();

  pollInterval = setInterval(refreshState, 500);
  bindEvents();
}

// ─── Quote ────────────────────────────────────────────────────
function showRandomQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  quoteText.textContent   = `"${q.text}"`;
  quoteAuthor.textContent = `— ${q.author}`;
}

// ─── Poll service worker ──────────────────────────────────────
async function refreshState() {
  try {
    const res = await sendMessage({ action: 'getState' });
    if (!res || !res.timerState) return;

    const { timerState, studyStats } = res;

    isRunning   = timerState.isRunning;
    currentMode = timerState.mode;

    updateTimerDisplay(timerState.remainingSeconds, timerState.mode);
    updateControls(timerState.isRunning, timerState.remainingSeconds, timerState.mode);
    updateBadge(timerState.mode, studyStats);
    updateStats(studyStats);

    // Detect when session switches (service worker changed mode)
    if (lastKnownMode !== timerState.mode) {
      lastKnownMode = timerState.mode;
      flashSessionComplete(timerState.mode);
    }
  } catch (e) {
    console.error('[FocusTube] refreshState error:', e);
  }
}

// ─── Timer Display ────────────────────────────────────────────
function updateTimerDisplay(remaining, mode) {
  const total = mode === 'study' ? STUDY_DURATION : BREAK_DURATION;
  const safeR = Math.max(0, remaining);

  const m = Math.floor(safeR / 60).toString().padStart(2, '0');
  const s = Math.floor(safeR % 60).toString().padStart(2, '0');
  timerTime.textContent = `${m}:${s}`;

  const ratio  = safeR / total;
  const offset = CIRCUMFERENCE * (1 - ratio);
  ringProgress.style.strokeDashoffset = offset;

  // Colour the ring differently for break vs study
  ringProgress.style.stroke = mode === 'break' ? '#B07878' : '';

  timerLabel.textContent = mode === 'study' ? 'Study Session' : 'Break Time ☕';
}

function updateControls(running, remaining, mode) {
  const total   = mode === 'study' ? STUDY_DURATION : BREAK_DURATION;
  const atStart = remaining >= total;

  if (running) {
    btnStartText.textContent = 'Pause';
    playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    btnStart.classList.add('running');
  } else {
    btnStartText.textContent = atStart ? 'Start' : 'Resume';
    playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    btnStart.classList.remove('running');
  }
}

function updateBadge(mode, stats) {
  const count = (stats && stats.completedPomodoros) || 0;
  if (mode === 'study') {
    sessionBadge.textContent = `Study #${count + 1}`;
    sessionBadge.className   = 'session-badge badge-study';
  } else {
    sessionBadge.textContent = 'Break ☕';
    sessionBadge.className   = 'session-badge badge-break';
  }
}

function updateStats(stats) {
  if (!stats) return;
  const mins  = Math.floor((stats.totalStudySeconds || 0) / 60);
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  statTime.textContent     = hours > 0 ? `${hours}h ${rem}m` : `${mins}m`;
  statPomodoros.textContent = stats.completedPomodoros || 0;
}

// Flash ring + show in-popup toast when session switches
function flashSessionComplete(newMode) {
  const origStroke = ringProgress.style.stroke;
  ringProgress.style.stroke = '#FF9494';
  setTimeout(() => { ringProgress.style.stroke = origStroke || ''; }, 800);

  const msg = newMode === 'break'
    ? '🎉 Study done! Open popup to start your break.'
    : '☕ Break over! Open popup to start studying.';
  showToast(msg);
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 3500);
}

// ─── Event Bindings ───────────────────────────────────────────
function bindEvents() {

  // Start / Pause / Resume — single button does all three
  btnStart.addEventListener('click', async () => {
    if (isRunning) {
      await sendMessage({ action: 'pauseTimer' });
    } else {
      await sendMessage({ action: 'startTimer' });
    }
    await refreshState();
  });

  // Reset current session
  btnReset.addEventListener('click', async () => {
    await sendMessage({ action: 'resetTimer' });
    await refreshState();
  });

  // Skip to next session (study → break or break → study)
  btnSkip.addEventListener('click', async () => {
    const nextMode = currentMode === 'study' ? 'break' : 'study';
    await sendMessage({ action: 'switchMode', mode: nextMode });
    await refreshState();
  });

  // Focus Mode toggle
  focusToggle.addEventListener('change', async () => {
    const enabled = focusToggle.checked;
    await storageSet({ focusMode: enabled });
    await messageAllYouTubeTabs({ action: 'focusModeChanged', enabled, allowlist });
    showToast(enabled ? '🎯 Focus Mode enabled!' : '✅ Focus Mode disabled.');
  });

  // Add channel
  btnAddChannel.addEventListener('click', addChannel);
  channelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addChannel();
  });

  // Quote refresh
  if (quoteRefresh) {
    quoteRefresh.addEventListener('click', () => {
      showRandomQuote();
      quoteRefresh.style.transform = 'rotate(360deg)';
      setTimeout(() => { quoteRefresh.style.transform = ''; }, 500);
    });
  }
}

// ─── Focus Mode ───────────────────────────────────────────────
async function loadFocusMode() {
  const { focusMode } = await storageGet(['focusMode']);
  focusToggle.checked = focusMode || false;
}

// ─── Allowlist ────────────────────────────────────────────────
async function loadAllowlist() {
  const { allowlist: saved } = await storageGet(['allowlist']);
  allowlist = saved || [];
  renderAllowlist();
}

async function addChannel() {
  const value = channelInput.value.trim();
  if (!value) return;
  if (allowlist.some(c => c.toLowerCase() === value.toLowerCase())) {
    showToast('Channel already in list!');
    return;
  }
  allowlist.push(value);
  channelInput.value = '';
  await storageSet({ allowlist });
  await messageAllYouTubeTabs({ action: 'allowlistChanged', allowlist });
  renderAllowlist();
  showToast(`✅ "${value}" added!`);
}

async function removeChannel(name) {
  allowlist = allowlist.filter(c => c !== name);
  await storageSet({ allowlist });
  await messageAllYouTubeTabs({ action: 'allowlistChanged', allowlist });
  renderAllowlist();
}

function renderAllowlist() {
  channelList.innerHTML = '';
  if (allowlist.length === 0) {
    channelList.innerHTML = '<li class="empty-list">All channels allowed</li>';
    return;
  }
  allowlist.forEach(name => {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.innerHTML = `
      <span class="channel-name">📺 ${escapeHtml(name)}</span>
      <button class="btn-remove" title="Remove">×</button>`;
    li.querySelector('.btn-remove').addEventListener('click', () => removeChannel(name));
    channelList.appendChild(li);
  });
}

// ─── Helpers ──────────────────────────────────────────────────
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(response);
    });
  });
}

async function messageAllYouTubeTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message, () => { chrome.runtime.lastError; });
    });
  } catch (e) {
    console.warn('[FocusTube] Could not message YouTube tabs:', e);
  }
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────
window.addEventListener('unload', () => clearInterval(pollInterval));
init();
