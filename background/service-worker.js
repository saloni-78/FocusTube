/**
 * background/service-worker.js
 * ─────────────────────────────────────────────────────────────
 * The brain of FocusTube. Owns the Pomodoro timer.
 *
 * KEY BEHAVIOUR (v3):
 *   • Timer stores remainingSeconds precisely when paused.
 *   • startTimer correctly resumes from remainingSeconds.
 *   • Alarm fires every minute; remaining is computed live from startedAt.
 *   • When a session ends → timer STOPS, sends notification.
 *   • Next session is loaded and ready but NOT auto-started.
 *   • User must click Start manually to begin the next session.
 * ─────────────────────────────────────────────────────────────
 */

const ALARM_NAME         = 'pomodoroTick';
const STUDY_DURATION_SEC = 25 * 60;   // 25 minutes
const BREAK_DURATION_SEC =  5 * 60;   //  5 minutes

// ─── Install: set default storage values ─────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await getStorage(['timerState', 'focusMode', 'allowlist', 'studyStats']);
  const defaults = {};

  if (!existing.timerState) {
    defaults.timerState = {
      isRunning:        false,
      mode:             'study',
      remainingSeconds: STUDY_DURATION_SEC,
      startedAt:        null,
    };
  }

  if (existing.focusMode === undefined) defaults.focusMode  = false;
  if (!existing.allowlist)              defaults.allowlist  = [];
  if (!existing.studyStats) {
    defaults.studyStats = {
      date:               new Date().toDateString(),
      totalStudySeconds:  0,
      completedPomodoros: 0,
    };
  }

  if (Object.keys(defaults).length > 0) await setStorage(defaults);
  console.log('[FocusTube] Installed & initialized.');
});

// ─── Alarm fires every ~1 minute (Chrome minimum) ────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const { timerState, studyStats } = await getStorage(['timerState', 'studyStats']);

  if (!timerState?.isRunning || !timerState?.startedAt) {
    chrome.alarms.clear(ALARM_NAME);
    return;
  }

  // Compute remaining using live clock delta from startedAt
  const elapsed   = Math.floor((Date.now() - timerState.startedAt) / 1000);
  const remaining = timerState.remainingSeconds - elapsed;

  if (remaining <= 0) {
    // Session is complete — handle it
    await handleSessionComplete(timerState, studyStats || {});
  } else {
    // Still running — persist latest remaining so popup reads fresh value
    await setStorage({ timerState: { ...timerState } });
  }
});

// ─── Session complete handler ─────────────────────────────────
async function handleSessionComplete(timerState, studyStats) {
  // 1. Stop the alarm
  await chrome.alarms.clear(ALARM_NAME);

  const wasStudying  = timerState.mode === 'study';
  const nextMode     = wasStudying ? 'break' : 'study';
  const nextDuration = nextMode === 'study' ? STUDY_DURATION_SEC : BREAK_DURATION_SEC;

  // 2. Update daily stats (reset if new day)
  let stats = { ...studyStats };
  if (stats.date !== new Date().toDateString()) {
    stats = { date: new Date().toDateString(), totalStudySeconds: 0, completedPomodoros: 0 };
  }
  if (wasStudying) {
    stats.totalStudySeconds  += STUDY_DURATION_SEC;
    stats.completedPomodoros += 1;
  }

  // 3. Set timer to next session — NOT running (user starts manually)
  const newTimerState = {
    isRunning:        false,          // ← stopped, user must start
    mode:             nextMode,
    remainingSeconds: nextDuration,
    startedAt:        null,
  };

  await setStorage({ timerState: newTimerState, studyStats: stats });

  // 4. Desktop notification
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    await createNotification(`ft-${Date.now()}`, {
      type:     'basic',
      iconUrl,
      title:    wasStudying ? '🎉 Study Session Complete!' : '☕ Break is Over!',
      message:  wasStudying
        ? 'Amazing work! Your 5-min break is ready. Click Start when you are.'
        : 'Break done! Your 25-min study session is ready. Click Start when you are.',
      priority: 2,
    });
  } catch (e) {
    console.error('[FocusTube] Notification failed:', e);
  }
}

// ─── Message handler (from popup) ────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // keep message channel open for async
});

async function handleMessage(msg) {
  const { timerState, studyStats } = await getStorage(['timerState', 'studyStats']);

  // ── GET STATE ──────────────────────────────────────────────
  if (msg.action === 'getState') {
    let state = timerState || {
      isRunning: false, mode: 'study',
      remainingSeconds: STUDY_DURATION_SEC, startedAt: null,
    };

    // Compute accurate remaining from timestamp (so popup is always in sync)
    if (state.isRunning && state.startedAt) {
      const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000);
      const remaining = Math.max(0, state.remainingSeconds - elapsed);

      // If timer has expired but alarm hasn't fired yet, handle completion
      if (remaining <= 0) {
        await handleSessionComplete(state, studyStats || {});
        const { timerState: freshState, studyStats: freshStats } = await getStorage(['timerState', 'studyStats']);
        return { timerState: freshState, studyStats: freshStats || {} };
      }

      state = { ...state, remainingSeconds: remaining };
    }

    return { timerState: state, studyStats: studyStats || {} };
  }

  // ── START (also handles resume from paused state) ──────────
  if (msg.action === 'startTimer') {
    const state = timerState || {
      isRunning: false, mode: 'study',
      remainingSeconds: STUDY_DURATION_SEC, startedAt: null,
    };

    // remainingSeconds already holds correct paused-at value.
    // We record startedAt = now, and use remainingSeconds as budget.
    const newState = {
      ...state,
      isRunning: true,
      startedAt: Date.now(),
      // remainingSeconds is kept as-is (paused remainder or full duration)
    };
    await setStorage({ timerState: newState });

    // Clear any stale alarm then create fresh one
    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

    return { success: true };
  }

  // ── PAUSE ──────────────────────────────────────────────────
  if (msg.action === 'pauseTimer') {
    if (!timerState) return { success: true };

    // Snapshot how many seconds are left right now
    const elapsed   = timerState.startedAt
      ? Math.floor((Date.now() - timerState.startedAt) / 1000) : 0;
    const remaining = Math.max(0, timerState.remainingSeconds - elapsed);

    const newState = { ...timerState, isRunning: false, remainingSeconds: remaining, startedAt: null };
    await setStorage({ timerState: newState });
    await chrome.alarms.clear(ALARM_NAME);

    return { success: true };
  }

  // ── RESET ──────────────────────────────────────────────────
  if (msg.action === 'resetTimer') {
    const mode     = timerState?.mode || 'study';
    const duration = mode === 'study' ? STUDY_DURATION_SEC : BREAK_DURATION_SEC;
    const newState = { isRunning: false, mode, remainingSeconds: duration, startedAt: null };
    await setStorage({ timerState: newState });
    await chrome.alarms.clear(ALARM_NAME);
    return { success: true };
  }

  // ── SWITCH MODE ────────────────────────────────────────────
  if (msg.action === 'switchMode') {
    const duration = msg.mode === 'study' ? STUDY_DURATION_SEC : BREAK_DURATION_SEC;
    const newState = { isRunning: false, mode: msg.mode, remainingSeconds: duration, startedAt: null };
    await setStorage({ timerState: newState });
    await chrome.alarms.clear(ALARM_NAME);
    return { success: true };
  }

  // ── RESET STATS ────────────────────────────────────────────
  if (msg.action === 'resetStats') {
    const freshStats = { date: new Date().toDateString(), totalStudySeconds: 0, completedPomodoros: 0 };
    await setStorage({ studyStats: freshStats });
    return { success: true };
  }

  return { success: false, error: 'Unknown action: ' + msg.action };
}

// ─── Storage helpers ──────────────────────────────────────────
function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function createNotification(id, options) {
  return new Promise((resolve, reject) => {
    chrome.notifications.create(id, options, createdId => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(createdId);
    });
  });
}
