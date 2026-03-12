/**
 * Learning Wrapper - Integrates pattern learning with browser commands
 *
 * Flow:
 * 1. Check pattern cache for known pattern
 * 2. If no pattern OR consent needed, request consent
 * 3. Execute action
 * 4. Request feedback
 * 5. Learn from result
 */

import type { BrowserActionParams, BrowserActKind } from '../types/messages.js';
import type { LearnableAction, BrowserPattern } from '../types/patterns.js';

import { executeCommand } from './browser-commands.js';
import {
  patternCache,
  extractDomain,
  getBreakpoint,
} from './pattern-cache.js';
import {
  requestConsent,
  describeAction,
  shouldSkipConsent,
} from './consent-manager.js';
import { requestFeedback } from './feedback-collector.js';

/**
 * Map of browser action kinds to learnable actions
 */
const ACTION_MAP: Record<string, LearnableAction | null> = {
  click: 'click',
  click_at: 'click',
  click_a11y: 'click',
  type: 'type',
  type_at: 'type',
  type_a11y: 'type',
  type_raw: 'type',
  scroll: 'scroll',
  hover: 'hover',
  select: 'select',
  // Non-learnable actions
  screenshot: null,
  snapshot: null,
  snapshot_a11y: null,
  navigate: null,
  open: null,
  close: null,
  tabs: null,
  status: null,
  console: null,
  press: null,
  press_key: null,
};

/**
 * Get learnable action from action + kind params
 * Handles the "act" action which uses "kind" to specify the actual action type
 */
function getLearnableAction(action: string, params: BrowserActionParams): LearnableAction | null {
  // For "act" actions, check the "kind" param
  if (action === 'act' && params.kind) {
    return ACTION_MAP[params.kind] ?? null;
  }
  return ACTION_MAP[action] ?? null;
}

/**
 * Execute a browser action with learning integration
 *
 * @param action - The browser action to execute
 * @param params - Action parameters
 * @param jobId - Job ID for tracking
 * @param learningEnabled - Whether to use pattern learning (default: true)
 */
export async function executeWithLearning(
  action: string,
  params: BrowserActionParams,
  jobId: string,
  learningEnabled: boolean = true
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
  usedPattern?: boolean;
  patternId?: string;
}> {
  const learnableAction = getLearnableAction(action, params);
  console.log(`[Learning] action=${action}, kind=${params.kind}, learnableAction=${learnableAction}`);

  // If not learnable or learning disabled, execute directly
  if (!learnableAction || !learningEnabled) {
    const result = await executeCommand(action as any, params);
    return {
      success: result.success,
      result: result.result,
      error: result.error,
      usedPattern: false,
    };
  }

  const url = params.url || await getCurrentTabUrl();
  const domain = extractDomain(url);
  const viewport = await getViewport(params.targetId);

  // Build intent description
  const description = describeAction(learnableAction, {
    selector: params.selector || params.ref,
    text: params.text,
    coordinates: params.x !== undefined ? { x: params.x, y: params.y! } : undefined,
  });

  // Step 1: Check pattern cache
  let matchedPattern: BrowserPattern | null = null;
  let patternConfidence = 0;

  const patternMatch = await patternCache.findPattern({
    domain,
    intent: description,
    action: learnableAction,
    viewport,
  });

  if (patternMatch) {
    matchedPattern = patternMatch.pattern;
    patternConfidence = patternMatch.confidence;
    console.log(`[Learning] Found pattern ${matchedPattern.id} with confidence ${patternConfidence.toFixed(2)}`);
  }

  // Step 2: Check if consent needed
  const needsConsent = !shouldSkipConsent(learnableAction);
  console.log(`[Learning] needsConsent=${needsConsent} for action=${learnableAction}`);

  if (needsConsent) {
    console.log('[Learning] Requesting consent...');
    const approved = await requestConsent({
      jobId,
      action: learnableAction,
      description,
      url,
      selector: params.selector,
      coordinates: params.x !== undefined ? { x: params.x, y: params.y! } : undefined,
      patternMatch: matchedPattern ? {
        patternId: matchedPattern.id,
        confidence: patternConfidence,
      } : undefined,
    });

    if (!approved) {
      console.log('[Learning] Action denied by user');
      return {
        success: false,
        error: 'Action denied by user',
        usedPattern: false,
      };
    }
  }

  // Step 3: Try to execute with pattern if available and high confidence
  let result: { success: boolean; result?: unknown; error?: string };
  let usedPattern = false;
  let selectorUsed: {
    type: 'css' | 'a11y' | 'coordinates' | 'pattern';
    value: string;
    coordinates?: { x: number; y: number };
    screenshotDimensions?: { width: number; height: number };
  } | undefined;

  if (matchedPattern && patternConfidence >= 0.7) {
    // Try using cached pattern first
    result = await executeWithPattern(action, params, matchedPattern, viewport);

    if (result.success) {
      usedPattern = true;
      selectorUsed = {
        type: 'pattern',
        value: matchedPattern.id,
        coordinates: matchedPattern.selector.relativeX !== undefined ? {
          x: Math.round(matchedPattern.selector.relativeX * viewport.width),
          y: Math.round(matchedPattern.selector.relativeY! * viewport.height),
        } : undefined,
        screenshotDimensions: { width: viewport.width, height: viewport.height },
      };
      console.log('[Learning] Pattern execution succeeded');
    } else {
      // Pattern failed, decrement confidence and fallback
      await patternCache.decrementConfidence(matchedPattern.id);
      console.log('[Learning] Pattern execution failed, falling back to normal execution');
      result = await executeCommand(action as any, params);

      // Track what selector was actually used
      selectorUsed = buildSelectorUsed(action, params, viewport);
    }
  } else {
    // No high-confidence pattern, execute normally
    result = await executeCommand(action as any, params);
    selectorUsed = buildSelectorUsed(action, params, viewport);
  }

  // Step 4: Request feedback (async, non-blocking)
  requestFeedback({
    jobId,
    action: learnableAction,
    description,
    url,
    success: result.success,
    result: result.result,
    error: result.error,
    selectorUsed,
    viewport,
  }).catch(err => {
    console.error('[Learning] Feedback request error:', err);
  });

  return {
    success: result.success,
    result: result.result,
    error: result.error,
    usedPattern,
    patternId: usedPattern ? matchedPattern?.id : undefined,
  };
}

/**
 * Execute action using a cached pattern
 */
async function executeWithPattern(
  action: string,
  originalParams: BrowserActionParams,
  pattern: BrowserPattern,
  viewport: { width: number; height: number }
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // Build params from pattern
  const patternParams: BrowserActionParams = { ...originalParams };

  // Use relative coordinates if available
  if (pattern.selector.relativeX !== undefined && pattern.selector.relativeY !== undefined) {
    const x = Math.round(pattern.selector.relativeX * viewport.width);
    const y = Math.round(pattern.selector.relativeY * viewport.height);

    if (action.includes('click') || action === 'click_at') {
      patternParams.x = x;
      patternParams.y = y;
      // Use coordinates action
      return await executeCommand('click_at', patternParams);
    }

    if (action.includes('type') || action === 'type_at') {
      patternParams.x = x;
      patternParams.y = y;
      return await executeCommand('type_at', patternParams);
    }
  }

  // Use CSS hint if available
  if (pattern.selector.cssHint) {
    patternParams.selector = pattern.selector.cssHint;
    return await executeCommand(action as any, patternParams);
  }

  // Use A11y info if available
  if (pattern.a11y) {
    if (action.includes('click')) {
      patternParams.element = pattern.a11y.name;
      return await executeCommand('click_a11y', patternParams);
    }
    if (action.includes('type')) {
      patternParams.element = pattern.a11y.name;
      return await executeCommand('type_a11y', patternParams);
    }
  }

  // Fallback to original execution
  return await executeCommand(action as any, originalParams);
}

/**
 * Build selector info for learning from action params
 */
function buildSelectorUsed(
  action: string,
  params: BrowserActionParams,
  viewport: { width: number; height: number }
): {
  type: 'css' | 'a11y' | 'coordinates' | 'pattern';
  value: string;
  coordinates?: { x: number; y: number };
  screenshotDimensions?: { width: number; height: number };
} | undefined {
  if (params.selector) {
    return { type: 'css', value: params.selector };
  }

  if (params.ref) {
    return { type: 'css', value: params.ref };
  }

  if (action.includes('a11y') && params.element) {
    return { type: 'a11y', value: `${params.element}` };
  }

  if (params.x !== undefined && params.y !== undefined) {
    return {
      type: 'coordinates',
      value: `${params.x},${params.y}`,
      coordinates: { x: params.x, y: params.y },
      screenshotDimensions: params.screenshotWidth && params.screenshotHeight
        ? { width: params.screenshotWidth, height: params.screenshotHeight }
        : { width: viewport.width, height: viewport.height },
    };
  }

  return undefined;
}

/**
 * Get current tab URL
 */
async function getCurrentTabUrl(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || '';
  } catch {
    return '';
  }
}

/**
 * Get viewport dimensions
 */
async function getViewport(
  targetId?: string | number
): Promise<{ width: number; height: number }> {
  try {
    let tabId: number | undefined = targetId
      ? typeof targetId === 'string'
        ? parseInt(targetId, 10)
        : targetId
      : undefined;

    if (!tabId || isNaN(tabId)) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }

    if (!tabId) {
      return { width: 1920, height: 1080 };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: window.innerWidth, height: window.innerHeight }),
    });

    return results[0]?.result || { width: 1920, height: 1080 };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

/**
 * Get learning stats
 */
export async function getLearningStats(): Promise<{
  totalPatterns: number;
  totalActions: number;
  patternHitRate: number;
  successRate: number;
  topDomains: { domain: string; patterns: number }[];
}> {
  const stats = await patternCache.getStats();
  const patterns = await patternCache.exportPatterns();

  // Count patterns per domain
  const domainCounts = new Map<string, number>();
  for (const pattern of patterns) {
    const count = domainCounts.get(pattern.domain) || 0;
    domainCounts.set(pattern.domain, count + 1);
  }

  const topDomains = Array.from(domainCounts.entries())
    .map(([domain, patterns]) => ({ domain, patterns }))
    .sort((a, b) => b.patterns - a.patterns)
    .slice(0, 5);

  return {
    totalPatterns: patterns.length,
    totalActions: stats.totalActions,
    patternHitRate: stats.totalActions > 0
      ? stats.patternHits / stats.totalActions
      : 0,
    successRate: stats.totalActions > 0
      ? stats.successfulActions / stats.totalActions
      : 0,
    topDomains,
  };
}

/**
 * Clear all learned patterns
 */
export async function clearLearning(): Promise<void> {
  await patternCache.clearPatterns();
}

/**
 * Toggle learning on/off
 */
export async function setLearningEnabled(enabled: boolean): Promise<void> {
  await patternCache.updateSettings({ enableLearning: enabled });
}

/**
 * Check if learning is enabled
 */
export async function isLearningEnabled(): Promise<boolean> {
  const settings = await patternCache.getSettings();
  return settings.enableLearning;
}
