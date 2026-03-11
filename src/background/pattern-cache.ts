/**
 * Pattern Cache - Stores and retrieves learned browser patterns
 *
 * Privacy-safe: Only stores structural patterns, no user content.
 * Uses chrome.storage.local for persistence.
 */

import type {
  BrowserPattern,
  ConsentPreference,
  PatternStorage,
  ViewportBreakpoint,
  LearnableAction,
  ActionFeedback,
} from '../types/patterns.js';

import { DEFAULT_PATTERN_STORAGE } from '../types/patterns.js';

const STORAGE_KEY = 'patternCache';

/**
 * Get viewport breakpoint from width
 */
export function getBreakpoint(width: number): ViewportBreakpoint {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1920) return 'desktop';
  return 'wide';
}

/**
 * Get width bucket range for a given width
 * Buckets: mobile (0-768), tablet (768-1024), desktop (1024-1920), wide (1920+)
 */
export function getWidthBucket(width: number): [number, number] {
  if (width < 768) return [0, 768];
  if (width < 1024) return [768, 1024];
  if (width < 1920) return [1024, 1920];
  return [1920, 4096];
}

/**
 * Get height bucket range
 */
export function getHeightBucket(height: number): [number, number] {
  if (height < 600) return [0, 600];
  if (height < 800) return [600, 800];
  if (height < 1080) return [800, 1080];
  if (height < 1440) return [1080, 1440];
  return [1440, 4096];
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Convert URL path to pattern (wildcarded)
 * e.g., "/user/123/profile" -> "/user/*/profile"
 */
export function toPathPattern(url: string): string {
  try {
    const parsed = new URL(url);
    // Replace numeric segments with wildcard
    return parsed.pathname
      .split('/')
      .map(seg => /^\d+$/.test(seg) ? '*' : seg)
      .join('/');
  } catch {
    return '/*';
  }
}

/**
 * Get quadrant from relative coordinates
 */
export function getQuadrant(relX: number, relY: number): BrowserPattern['selector']['quadrant'] {
  if (relX < 0.33 && relY < 0.33) return 'top-left';
  if (relX > 0.66 && relY < 0.33) return 'top-right';
  if (relX < 0.33 && relY > 0.66) return 'bottom-left';
  if (relX > 0.66 && relY > 0.66) return 'bottom-right';
  return 'center';
}

/**
 * Calculate similarity between two intents (simple word overlap)
 * Returns 0-1 score
 */
function intentSimilarity(intent1: string, intent2: string): number {
  const words1 = new Set(intent1.toLowerCase().split(/\s+/));
  const words2 = new Set(intent2.toLowerCase().split(/\s+/));

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection++;
  }

  const union = words1.size + words2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Pattern Cache Manager
 */
class PatternCacheManager {
  private cache: PatternStorage | null = null;
  private initialized = false;

  /**
   * Initialize cache from storage
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      this.cache = result[STORAGE_KEY] || { ...DEFAULT_PATTERN_STORAGE };
      this.initialized = true;
      console.log('[PatternCache] Initialized with', this.cache.patterns.length, 'patterns');
    } catch (error) {
      console.error('[PatternCache] Init error:', error);
      this.cache = { ...DEFAULT_PATTERN_STORAGE };
      this.initialized = true;
    }
  }

  /**
   * Save cache to storage
   */
  private async save(): Promise<void> {
    if (!this.cache) return;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: this.cache });
    } catch (error) {
      console.error('[PatternCache] Save error:', error);
    }
  }

  /**
   * Get current settings
   */
  async getSettings(): Promise<PatternStorage['settings']> {
    await this.init();
    return { ...this.cache!.settings };
  }

  /**
   * Update settings
   */
  async updateSettings(updates: Partial<PatternStorage['settings']>): Promise<void> {
    await this.init();
    this.cache!.settings = { ...this.cache!.settings, ...updates };
    await this.save();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<PatternStorage['stats']> {
    await this.init();
    return { ...this.cache!.stats };
  }

  /**
   * Find matching pattern for an action
   */
  async findPattern(params: {
    domain: string;
    intent: string;
    action: LearnableAction;
    viewport: { width: number; height: number };
  }): Promise<{ pattern: BrowserPattern; confidence: number } | null> {
    await this.init();

    const { domain, intent, action, viewport } = params;
    const breakpoint = getBreakpoint(viewport.width);

    // Find patterns matching domain + action + breakpoint
    const candidates = this.cache!.patterns.filter(p =>
      p.domain === domain &&
      p.actionType === action &&
      p.viewport.breakpoint === breakpoint &&
      p.confidence >= 0.3 // Only consider patterns with some confidence
    );

    if (candidates.length === 0) return null;

    // Score by intent similarity + confidence
    let bestMatch: { pattern: BrowserPattern; score: number } | null = null;

    for (const pattern of candidates) {
      const intentScore = intentSimilarity(intent, pattern.intentText);
      if (intentScore < 0.3) continue; // Skip low intent matches

      const combinedScore = (intentScore * 0.6) + (pattern.confidence * 0.4);

      if (!bestMatch || combinedScore > bestMatch.score) {
        bestMatch = { pattern, score: combinedScore };
      }
    }

    if (!bestMatch || bestMatch.score < 0.5) return null;

    // Update last used
    bestMatch.pattern.lastUsed = Date.now();
    await this.save();

    // Update stats
    this.cache!.stats.patternHits++;

    return {
      pattern: bestMatch.pattern,
      confidence: bestMatch.score,
    };
  }

  /**
   * Learn a new pattern from successful action
   */
  async learnPattern(params: {
    domain: string;
    url: string;
    intent: string;
    action: LearnableAction;
    viewport: { width: number; height: number };
    selector: BrowserPattern['selector'];
    a11y?: BrowserPattern['a11y'];
    feedback: ActionFeedback;
  }): Promise<void> {
    await this.init();

    const { domain, url, intent, action, viewport, selector, a11y, feedback } = params;

    // Check if learning is enabled
    if (!this.cache!.settings.enableLearning) {
      console.log('[PatternCache] Learning disabled, skipping');
      return;
    }

    const breakpoint = getBreakpoint(viewport.width);
    const pathPattern = toPathPattern(url);

    // Find existing pattern to update
    const existingIndex = this.cache!.patterns.findIndex(p =>
      p.domain === domain &&
      p.pathPattern === pathPattern &&
      p.intentText === intent &&
      p.actionType === action &&
      p.viewport.breakpoint === breakpoint
    );

    if (existingIndex >= 0) {
      // Update existing pattern
      const pattern = this.cache!.patterns[existingIndex];

      if (feedback === 'good') {
        pattern.successCount++;
      } else if (feedback === 'bad') {
        pattern.failCount++;
      }

      pattern.confidence = pattern.successCount / (pattern.successCount + pattern.failCount);
      pattern.lastUsed = Date.now();
      pattern.lastFeedback = feedback;

      // Update selector if this was a good result (might have better selector)
      if (feedback === 'good') {
        pattern.selector = { ...pattern.selector, ...selector };
        if (a11y) pattern.a11y = a11y;
      }

      console.log(`[PatternCache] Updated pattern ${pattern.id}, confidence: ${pattern.confidence.toFixed(2)}`);
    } else if (feedback === 'good') {
      // Create new pattern only on good feedback
      const newPattern: BrowserPattern = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        domain,
        pathPattern,
        viewport: {
          widthRange: getWidthBucket(viewport.width),
          heightRange: getHeightBucket(viewport.height),
          breakpoint,
        },
        intentText: intent,
        actionType: action,
        selector,
        a11y,
        successCount: 1,
        failCount: 0,
        confidence: 1.0,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        lastFeedback: feedback,
      };

      this.cache!.patterns.push(newPattern);
      console.log(`[PatternCache] Created new pattern ${newPattern.id}`);

      // Enforce max patterns limit
      await this.prunePatterns();
    } else if (feedback === 'bad') {
      // For bad feedback on non-existing pattern, just log
      console.log('[PatternCache] Bad feedback, no existing pattern to update');
    }

    // Update stats
    this.cache!.stats.feedbackCollected++;

    await this.save();
  }

  /**
   * Remove low-confidence and old patterns to stay under limit
   */
  private async prunePatterns(): Promise<void> {
    const maxPatterns = this.cache!.settings.maxStoredPatterns;

    if (this.cache!.patterns.length <= maxPatterns) return;

    // Sort by confidence * recency
    this.cache!.patterns.sort((a, b) => {
      const scoreA = a.confidence * (a.lastUsed / Date.now());
      const scoreB = b.confidence * (b.lastUsed / Date.now());
      return scoreB - scoreA;
    });

    // Keep top patterns
    const removed = this.cache!.patterns.length - maxPatterns;
    this.cache!.patterns = this.cache!.patterns.slice(0, maxPatterns);
    console.log(`[PatternCache] Pruned ${removed} patterns`);
  }

  /**
   * Decrement confidence for a pattern (on failure without feedback)
   */
  async decrementConfidence(patternId: string): Promise<void> {
    await this.init();

    const pattern = this.cache!.patterns.find(p => p.id === patternId);
    if (pattern) {
      pattern.failCount++;
      pattern.confidence = pattern.successCount / (pattern.successCount + pattern.failCount);
      await this.save();
      console.log(`[PatternCache] Decremented ${patternId}, confidence: ${pattern.confidence.toFixed(2)}`);
    }
  }

  /**
   * Get consent preference for domain
   */
  async getConsent(domain: string): Promise<ConsentPreference | null> {
    await this.init();

    const consent = this.cache!.consents.find(c => c.domain === domain);

    // Check expiry
    if (consent && consent.expiresAt && consent.expiresAt < Date.now()) {
      // Remove expired consent
      this.cache!.consents = this.cache!.consents.filter(c => c.domain !== domain);
      await this.save();
      return null;
    }

    return consent || null;
  }

  /**
   * Set consent preference for domain
   */
  async setConsent(consent: ConsentPreference): Promise<void> {
    await this.init();

    const existingIndex = this.cache!.consents.findIndex(c => c.domain === consent.domain);

    if (existingIndex >= 0) {
      this.cache!.consents[existingIndex] = consent;
    } else {
      this.cache!.consents.push(consent);
    }

    await this.save();
  }

  /**
   * Increment action stats
   */
  async recordAction(usedPattern: boolean, success: boolean): Promise<void> {
    await this.init();

    this.cache!.stats.totalActions++;
    if (success) this.cache!.stats.successfulActions++;
    if (!usedPattern) this.cache!.stats.llmCalls++;

    await this.save();
  }

  /**
   * Get all patterns for a domain (for debugging/display)
   */
  async getPatternsForDomain(domain: string): Promise<BrowserPattern[]> {
    await this.init();
    return this.cache!.patterns.filter(p => p.domain === domain);
  }

  /**
   * Clear all patterns (for testing/reset)
   */
  async clearPatterns(): Promise<void> {
    await this.init();
    this.cache!.patterns = [];
    await this.save();
    console.log('[PatternCache] Cleared all patterns');
  }

  /**
   * Export patterns for backup
   */
  async exportPatterns(): Promise<BrowserPattern[]> {
    await this.init();
    return [...this.cache!.patterns];
  }

  /**
   * Import patterns from backup
   */
  async importPatterns(patterns: BrowserPattern[]): Promise<void> {
    await this.init();

    // Merge with existing, avoiding duplicates
    for (const pattern of patterns) {
      const exists = this.cache!.patterns.some(p =>
        p.domain === pattern.domain &&
        p.pathPattern === pattern.pathPattern &&
        p.intentText === pattern.intentText
      );

      if (!exists) {
        this.cache!.patterns.push(pattern);
      }
    }

    await this.prunePatterns();
    await this.save();
    console.log(`[PatternCache] Imported ${patterns.length} patterns`);
  }
}

// Singleton instance
export const patternCache = new PatternCacheManager();

// Re-export needed defaults
export { DEFAULT_PATTERN_STORAGE } from '../types/patterns.js';
