/**
 * Consent Manager - Handles user consent for browser actions
 *
 * Shows consent prompts before executing actions:
 * - First-time actions always ask
 * - High-confidence cached patterns can auto-approve
 * - User can "Allow for this site" to skip future prompts
 */

import type {
  PendingAction,
  LearnableAction,
  ConsentLevel,
} from '../types/patterns.js';

import { patternCache, extractDomain } from './pattern-cache.js';

// Pending actions awaiting consent
const pendingActions = new Map<string, {
  action: PendingAction;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Event emitter for popup communication
type ConsentListener = (action: PendingAction) => void;
const consentListeners: ConsentListener[] = [];

/**
 * Request consent for an action
 * Returns true if approved, false if denied
 */
export async function requestConsent(params: {
  jobId: string;
  action: LearnableAction;
  description: string;
  url: string;
  selector?: string;
  coordinates?: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };
  patternMatch?: { patternId: string; confidence: number };
}): Promise<boolean> {
  const domain = extractDomain(params.url);
  console.log(`[Consent] requestConsent: action=${params.action}, domain="${domain}", url=${params.url}`);

  // Check existing consent preference
  const consent = await patternCache.getConsent(domain);
  console.log(`[Consent] Existing consent for ${domain}:`, consent);

  if (consent) {
    if (consent.level === 'deny') {
      console.log(`[Consent] Denied by preference for ${domain}`);
      return false;
    }

    if (consent.level === 'allow_domain') {
      // Check if action type is allowed
      if (!consent.allowedActions || consent.allowedActions.includes(params.action)) {
        console.log(`[Consent] Auto-approved by domain preference for ${domain}`);
        return true;
      }
    }
  }

  // Check if high-confidence pattern match (auto-approve)
  const settings = await patternCache.getSettings();
  if (params.patternMatch && params.patternMatch.confidence >= settings.autoApproveConfidenceThreshold) {
    console.log(`[Consent] Auto-approved by high confidence pattern (${params.patternMatch.confidence.toFixed(2)})`);
    return true;
  }

  // Need to ask user
  console.log(`[Consent] No auto-approve, showing prompt to user`);
  const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pendingAction: PendingAction = {
    id: actionId,
    jobId: params.jobId,
    action: params.action,
    description: params.description,
    domain,
    url: params.url,
    selector: params.selector,
    coordinates: params.coordinates,
    boundingBox: params.boundingBox,
    createdAt: Date.now(),
    expiresAt: Date.now() + settings.consentTimeoutMs,
  };

  return new Promise((resolve) => {
    // Set up timeout for auto-reject
    const timeout = setTimeout(() => {
      console.log(`[Consent] Timeout for action ${actionId}`);
      pendingActions.delete(actionId);
      resolve(false);
    }, settings.consentTimeoutMs);

    // Store pending action
    pendingActions.set(actionId, {
      action: pendingAction,
      resolve,
      timeout,
    });

    // Notify listeners (popup)
    notifyConsentListeners(pendingAction);

    // Show notification badge
    showConsentBadge();

    console.log(`[Consent] Requesting consent for ${params.action} on ${domain}`);
  });
}

/**
 * Handle consent response from popup
 */
export async function handleConsentResponse(params: {
  actionId: string;
  approved: boolean;
  rememberForDomain?: boolean;
  rememberForPattern?: boolean;
}): Promise<void> {
  console.log(`[Consent] handleConsentResponse:`, params);
  const pending = pendingActions.get(params.actionId);
  if (!pending) {
    console.log(`[Consent] No pending action found for ${params.actionId}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingActions.delete(params.actionId);

  // Save consent preference if requested
  if (params.rememberForDomain) {
    // Allow ALL learnable actions for this domain, not just the current one
    await patternCache.setConsent({
      domain: pending.action.domain,
      level: params.approved ? 'allow_domain' : 'deny',
      allowedActions: undefined, // undefined = all actions allowed
      createdAt: Date.now(),
    });
    console.log(`[Consent] Saved preference for ${pending.action.domain}: ${params.approved ? 'allow ALL' : 'deny'}`);
  }

  // Update badge
  updateConsentBadge();

  // Resolve the promise
  pending.resolve(params.approved);
}

/**
 * Get all pending consent requests
 */
export function getPendingConsents(): PendingAction[] {
  return Array.from(pendingActions.values())
    .map(p => p.action)
    .filter(a => a.expiresAt > Date.now());
}

/**
 * Cancel a pending consent request
 */
export function cancelConsent(actionId: string): void {
  const pending = pendingActions.get(actionId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingActions.delete(actionId);
    pending.resolve(false);
    updateConsentBadge();
  }
}

/**
 * Register a listener for consent requests
 */
export function addConsentListener(listener: ConsentListener): void {
  consentListeners.push(listener);
}

/**
 * Remove a consent listener
 */
export function removeConsentListener(listener: ConsentListener): void {
  const index = consentListeners.indexOf(listener);
  if (index >= 0) {
    consentListeners.splice(index, 1);
  }
}

/**
 * Notify all listeners of a new consent request
 */
function notifyConsentListeners(action: PendingAction): void {
  for (const listener of consentListeners) {
    try {
      listener(action);
    } catch (error) {
      console.error('[Consent] Listener error:', error);
    }
  }

  // Also send message to popup if open
  chrome.runtime.sendMessage({
    type: 'CONSENT_REQUEST',
    payload: action,
  }).catch(() => {
    // Popup might not be open
  });
}

/**
 * Show badge indicating pending consent and auto-open sidepanel
 */
async function showConsentBadge(): Promise<void> {
  const count = pendingActions.size;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF9800' }); // Orange for attention

    // Auto-open sidepanel for consent
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        await chrome.sidePanel.open({ tabId: activeTab.id });
      }
    } catch (e) {
      console.log('[Consent] Could not auto-open sidepanel:', e);
    }
  }
}

/**
 * Update badge based on pending consents
 */
function updateConsentBadge(): void {
  const count = pendingActions.size;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF9800' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Generate human-readable description for action
 */
export function describeAction(
  action: LearnableAction,
  details: { selector?: string; text?: string; coordinates?: { x: number; y: number } }
): string {
  switch (action) {
    case 'click':
      if (details.selector) {
        return `Click on "${details.selector}"`;
      }
      if (details.coordinates) {
        return `Click at position (${details.coordinates.x}, ${details.coordinates.y})`;
      }
      return 'Click on element';

    case 'type':
      const textPreview = details.text
        ? details.text.length > 20
          ? `"${details.text.slice(0, 20)}..."`
          : `"${details.text}"`
        : '';
      return `Type ${textPreview}`;

    case 'scroll':
      return 'Scroll the page';

    case 'hover':
      return `Hover over "${details.selector || 'element'}"`;

    case 'select':
      return `Select option from dropdown`;

    default:
      return `Perform ${action}`;
  }
}

/**
 * Check if an action should skip consent (for non-sensitive actions)
 */
export function shouldSkipConsent(action: LearnableAction): boolean {
  // Never skip for type (might be sensitive data)
  if (action === 'type') return false;

  // Scroll and hover are usually safe
  if (action === 'scroll' || action === 'hover') return true;

  return false;
}
