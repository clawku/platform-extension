/**
 * Feedback Collector - Collects user feedback after actions
 *
 * Shows thumbs up/down prompt after actions complete:
 * - Auto-dismisses after timeout (assumed good)
 * - Feedback updates pattern confidence
 * - Privacy-safe: no user content stored
 */

import type {
  PendingFeedback,
  LearnableAction,
  ActionFeedback,
  BrowserPattern,
} from '../types/patterns.js';

import { patternCache, extractDomain, toPathPattern, getQuadrant } from './pattern-cache.js';

// Pending feedback requests
const pendingFeedback = new Map<string, {
  feedback: PendingFeedback;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Event emitter for popup communication
type FeedbackListener = (feedback: PendingFeedback) => void;
const feedbackListeners: FeedbackListener[] = [];

/**
 * Request feedback for a completed action
 * Returns immediately - feedback is collected asynchronously
 */
export async function requestFeedback(params: {
  jobId: string;
  action: LearnableAction;
  description: string;
  url: string;
  success: boolean;
  result?: unknown;
  error?: string;
  selectorUsed?: {
    type: 'css' | 'a11y' | 'coordinates' | 'pattern';
    value: string;
    coordinates?: { x: number; y: number };
    screenshotDimensions?: { width: number; height: number };
  };
  viewport?: { width: number; height: number };
}): Promise<void> {
  const settings = await patternCache.getSettings();

  // Skip feedback for failed actions (unless it was a pattern that failed)
  if (!params.success && params.selectorUsed?.type !== 'pattern') {
    console.log('[Feedback] Skipping feedback for non-pattern failure');
    return;
  }

  const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pending: PendingFeedback = {
    id: feedbackId,
    jobId: params.jobId,
    action: params.action,
    description: params.description,
    domain: extractDomain(params.url),
    success: params.success,
    result: params.result,
    error: params.error,
    selectorUsed: params.selectorUsed,
    viewport: params.viewport,
    createdAt: Date.now(),
    expiresAt: Date.now() + settings.feedbackTimeoutMs,
  };

  // Set up timeout for auto-dismiss (assumed good)
  const timeout = setTimeout(() => {
    console.log(`[Feedback] Timeout for ${feedbackId}, assuming good`);
    handleFeedbackTimeout(feedbackId);
  }, settings.feedbackTimeoutMs);

  pendingFeedback.set(feedbackId, { feedback: pending, timeout });

  // Notify listeners
  notifyFeedbackListeners(pending);

  // Show notification badge
  showFeedbackBadge();

  console.log(`[Feedback] Requesting feedback for ${params.action} on ${pending.domain}`);
}

/**
 * Handle feedback response from user
 */
export async function handleFeedbackResponse(params: {
  feedbackId: string;
  feedback: ActionFeedback;
}): Promise<void> {
  const pending = pendingFeedback.get(params.feedbackId);
  if (!pending) {
    console.log(`[Feedback] No pending feedback found for ${params.feedbackId}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingFeedback.delete(params.feedbackId);

  // Update badge
  updateFeedbackBadge();

  // Learn from feedback
  await learnFromFeedback(pending.feedback, params.feedback);

  console.log(`[Feedback] Received ${params.feedback} for ${params.feedbackId}`);
}

/**
 * Handle feedback timeout - assume good if successful
 */
async function handleFeedbackTimeout(feedbackId: string): Promise<void> {
  const pending = pendingFeedback.get(feedbackId);
  if (!pending) return;

  pendingFeedback.delete(feedbackId);
  updateFeedbackBadge();

  // Assume good if action was successful
  const feedback: ActionFeedback = pending.feedback.success ? 'good' : 'skipped';
  await learnFromFeedback(pending.feedback, feedback);
}

/**
 * Learn from feedback - update pattern cache
 */
async function learnFromFeedback(
  pendingFb: PendingFeedback,
  feedback: ActionFeedback
): Promise<void> {
  if (feedback === 'skipped') {
    console.log('[Feedback] Skipped, not learning');
    return;
  }

  const { domain, action, description, selectorUsed, viewport } = pendingFb;

  // Build selector info for pattern
  const selector: BrowserPattern['selector'] = {};

  if (selectorUsed) {
    if (selectorUsed.type === 'css') {
      selector.cssHint = selectorUsed.value;
    } else if (selectorUsed.type === 'a11y') {
      // Parse a11y selector value (e.g., "button:Send")
      const parts = selectorUsed.value.split(':');
      if (parts.length >= 2) {
        selector.role = parts[0];
        selector.namePattern = parts[1];
      }
    }

    // Store relative coordinates if available
    if (selectorUsed.coordinates && selectorUsed.screenshotDimensions) {
      selector.relativeX = selectorUsed.coordinates.x / selectorUsed.screenshotDimensions.width;
      selector.relativeY = selectorUsed.coordinates.y / selectorUsed.screenshotDimensions.height;
      selector.quadrant = getQuadrant(selector.relativeX, selector.relativeY);
    }
  }

  // Extract intent from description
  // e.g., "Click on Send button" -> "send button"
  const intentText = description
    .toLowerCase()
    .replace(/^(click|type|scroll|hover|select)\s+(on|at|in|into)?\s*/i, '')
    .replace(/['"]/g, '')
    .trim() || description;

  // Learn the pattern
  await patternCache.learnPattern({
    domain,
    url: `https://${domain}/`, // Use domain as base URL
    intent: intentText,
    action,
    viewport: viewport || { width: 1920, height: 1080 },
    selector,
    feedback,
  });

  // Record action stats
  await patternCache.recordAction(
    selectorUsed?.type === 'pattern',
    pendingFb.success
  );
}

/**
 * Get all pending feedback requests
 */
export function getPendingFeedbacks(): PendingFeedback[] {
  return Array.from(pendingFeedback.values())
    .map(p => p.feedback)
    .filter(f => f.expiresAt > Date.now());
}

/**
 * Dismiss a feedback request (skip)
 */
export async function dismissFeedback(feedbackId: string): Promise<void> {
  const pending = pendingFeedback.get(feedbackId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingFeedback.delete(feedbackId);
    updateFeedbackBadge();
  }
}

/**
 * Register a listener for feedback requests
 */
export function addFeedbackListener(listener: FeedbackListener): void {
  feedbackListeners.push(listener);
}

/**
 * Remove a feedback listener
 */
export function removeFeedbackListener(listener: FeedbackListener): void {
  const index = feedbackListeners.indexOf(listener);
  if (index >= 0) {
    feedbackListeners.splice(index, 1);
  }
}

/**
 * Notify all listeners of a new feedback request
 */
function notifyFeedbackListeners(feedback: PendingFeedback): void {
  for (const listener of feedbackListeners) {
    try {
      listener(feedback);
    } catch (error) {
      console.error('[Feedback] Listener error:', error);
    }
  }

  // Also send message to popup if open
  chrome.runtime.sendMessage({
    type: 'FEEDBACK_REQUEST',
    payload: feedback,
  }).catch(() => {
    // Popup might not be open
  });
}

/**
 * Show badge indicating pending feedback
 */
function showFeedbackBadge(): void {
  const count = pendingFeedback.size;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // Green for feedback
  }
}

/**
 * Update badge based on pending feedback
 */
function updateFeedbackBadge(): void {
  const count = pendingFeedback.size;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Get feedback stats
 */
export async function getFeedbackStats(): Promise<{
  totalActions: number;
  successfulActions: number;
  patternHits: number;
  llmCalls: number;
  feedbackCollected: number;
  patternHitRate: number;
  successRate: number;
}> {
  const stats = await patternCache.getStats();

  return {
    ...stats,
    patternHitRate: stats.totalActions > 0
      ? stats.patternHits / stats.totalActions
      : 0,
    successRate: stats.totalActions > 0
      ? stats.successfulActions / stats.totalActions
      : 0,
  };
}
