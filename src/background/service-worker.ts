import { wsConnection } from './websocket.js';
import { pair, disconnect, getStatus, getStoredCredentials } from './auth.js';
import { createResultPayload } from './browser-commands.js';
import { patternCache } from './pattern-cache.js';
import { handleConsentResponse, getPendingConsents } from './consent-manager.js';
import { handleFeedbackResponse, getPendingFeedbacks } from './feedback-collector.js';
import { getLearningStats, clearLearning, setLearningEnabled, isLearningEnabled, executeWithLearning } from './learning-wrapper.js';
import type { BrowserJobMessage, PopupMessage } from '../types/messages.js';

console.log('[ServiceWorker] Starting Clawku Browser Extension');

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Fallback for older Chrome versions
});

// Activity log - store recent activities for debugging
interface Activity {
  id: string;
  timestamp: number;
  action: string;
  status: 'pending' | 'success' | 'error';
  details?: string;
  error?: string;
}

const MAX_ACTIVITIES = 20;

async function addActivity(activity: Omit<Activity, 'id' | 'timestamp'>): Promise<void> {
  const { activities = [] } = await chrome.storage.local.get('activities');
  const newActivity: Activity = {
    ...activity,
    id: Math.random().toString(36).slice(2),
    timestamp: Date.now(),
  };
  activities.unshift(newActivity);
  if (activities.length > MAX_ACTIVITIES) {
    activities.length = MAX_ACTIVITIES;
  }
  await chrome.storage.local.set({ activities });
}

async function updateActivity(id: string, update: Partial<Activity>): Promise<void> {
  const { activities = [] } = await chrome.storage.local.get('activities');
  const idx = activities.findIndex((a: Activity) => a.id === id);
  if (idx !== -1) {
    activities[idx] = { ...activities[idx], ...update };
    await chrome.storage.local.set({ activities });
  }
}

// Keep-alive alarm to prevent service worker suspension during long operations
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 }); // Every 20 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Just touch storage to keep service worker active
    // Offscreen document handles WebSocket reconnection
    chrome.storage.local.get(['wsConnected']).then(() => {
      console.log('[ServiceWorker] Keep-alive tick, connected:', wsConnection.isConnected());
    });
  }
});

// Handle incoming browser jobs from WebSocket
wsConnection.setMessageHandler(async (message: BrowserJobMessage) => {
  const { jobId, action, params, nonce, expiresAt } = message.payload;

  console.log('[ServiceWorker] Received job:', jobId, action);

  // Add activity entry
  const paramsStr = JSON.stringify(params).slice(0, 100);
  await addActivity({
    action,
    status: 'pending',
    details: paramsStr,
  });

  // Check if job has expired
  if (Date.now() > expiresAt) {
    console.log('[ServiceWorker] Job expired:', jobId);
    await addActivity({
      action,
      status: 'error',
      details: paramsStr,
      error: 'Job expired',
    });
    const result = createResultPayload(jobId, nonce, {
      success: false,
      error: 'Job expired',
    });
    wsConnection.sendResult(result);
    return;
  }

  // Execute the command with learning integration (consent + feedback + pattern cache)
  const commandResult = await executeWithLearning(action, params, jobId);

  // Log result
  const { activities = [] } = await chrome.storage.local.get('activities');
  if (activities.length > 0) {
    activities[0].status = commandResult.success ? 'success' : 'error';
    if (!commandResult.success && commandResult.error) {
      activities[0].error = commandResult.error;
    }
    if (commandResult.success && commandResult.result) {
      activities[0].details = JSON.stringify(commandResult.result).slice(0, 100);
    }
    await chrome.storage.local.set({ activities });
  }

  // Send result back
  const result = createResultPayload(jobId, nonce, commandResult);
  wsConnection.sendResult(result);

  // Update badge to show activity
  showActivityBadge();
});

// Show brief activity indicator
function showActivityBadge() {
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); // Blue

  setTimeout(() => {
    // Restore connected status
    if (wsConnection.isConnected()) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // Green
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }, 500);
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message: PopupMessage, sender, sendResponse) => {
  console.log('[ServiceWorker] Popup message:', message.type);

  (async () => {
    switch (message.type) {
      case 'GET_STATUS': {
        const status = await getStatus();
        status.connected = wsConnection.isConnected();
        sendResponse(status);
        break;
      }

      case 'PAIR': {
        if (!message.payload?.code) {
          sendResponse({ success: false, error: 'No code provided' });
          return;
        }

        const result = await pair(
          message.payload.code,
          message.payload.apiBaseUrl
        );

        if (result.success) {
          // Connect WebSocket after pairing
          await wsConnection.connect();
          await chrome.storage.local.set({ wsConnected: wsConnection.isConnected() });
        }

        sendResponse(result);
        break;
      }

      case 'DISCONNECT': {
        wsConnection.disconnect();
        await disconnect();
        await chrome.storage.local.set({ wsConnected: false });
        sendResponse({ success: true });
        break;
      }

      case 'RECONNECT': {
        const creds = await getStoredCredentials();
        if (!creds) {
          sendResponse({ success: false, error: 'Not paired' });
          return;
        }

        // Pass manual=true to reset reconnect attempts and properly handle the connection
        const connected = await wsConnection.connect(true);
        await chrome.storage.local.set({ wsConnected: connected });
        sendResponse({ success: connected, error: connected ? undefined : 'Connection failed' });
        break;
      }

      case 'GET_ACTIVITIES': {
        const { activities = [] } = await chrome.storage.local.get('activities');
        sendResponse({ activities });
        break;
      }

      case 'CLEAR_ACTIVITIES': {
        await chrome.storage.local.set({ activities: [] });
        sendResponse({ success: true });
        break;
      }

      // Learning/Pattern Cache
      case 'GET_LEARNING_STATS': {
        const stats = await getLearningStats();
        sendResponse(stats);
        break;
      }

      case 'GET_LEARNING_SETTINGS': {
        const settings = await patternCache.getSettings();
        sendResponse(settings);
        break;
      }

      case 'SET_LEARNING_ENABLED': {
        const enabled = message.payload?.enabled ?? true;
        await setLearningEnabled(enabled);
        sendResponse({ success: true });
        break;
      }

      case 'CLEAR_PATTERNS': {
        await clearLearning();
        sendResponse({ success: true });
        break;
      }

      case 'EXPORT_PATTERNS': {
        const patterns = await patternCache.exportPatterns();
        sendResponse(patterns);
        break;
      }

      // Consent handling
      case 'GET_PENDING_CONSENTS': {
        const pending = getPendingConsents();
        sendResponse(pending);
        break;
      }

      case 'CONSENT_RESPONSE': {
        console.log('[ServiceWorker] CONSENT_RESPONSE received:', message.payload);
        await handleConsentResponse(message.payload);
        sendResponse({ success: true });
        break;
      }

      // Feedback handling
      case 'GET_PENDING_FEEDBACKS': {
        const pending = getPendingFeedbacks();
        sendResponse(pending);
        break;
      }

      case 'FEEDBACK_RESPONSE': {
        await handleFeedbackResponse(message.payload);
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  })();

  return true; // Keep channel open for async response
});

// Auto-connect on startup if paired
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Browser startup - checking credentials');
  const creds = await getStoredCredentials();
  if (creds) {
    console.log('[ServiceWorker] Found credentials, connecting...');
    const connected = await wsConnection.connect();
    await chrome.storage.local.set({ wsConnected: connected });
  }
});

// Also try to connect when service worker activates
(async () => {
  const creds = await getStoredCredentials();
  if (creds) {
    console.log('[ServiceWorker] Credentials found on activate, connecting...');
    const connected = await wsConnection.connect();
    await chrome.storage.local.set({ wsConnected: connected });
  }
})();

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ServiceWorker] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    // Show welcome page - navigate to dashboard devices section
    chrome.tabs.create({
      url: 'https://clawku.id/?section=devices',
    });
  }
});
