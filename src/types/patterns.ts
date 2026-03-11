/**
 * Browser Pattern Learning Types
 *
 * Privacy-safe patterns learned from successful browser operations.
 * NO user data stored - only structural patterns.
 */

/** Viewport breakpoint for responsive pattern matching */
export type ViewportBreakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide';

/** Action types we can learn patterns for */
export type LearnableAction = 'click' | 'type' | 'scroll' | 'hover' | 'select';

/** User feedback on action result */
export type ActionFeedback = 'good' | 'bad' | 'skipped';

/** Consent level for actions */
export type ConsentLevel = 'ask_always' | 'allow_domain' | 'allow_pattern' | 'deny';

/**
 * A learned browser pattern - privacy safe
 * NO user content, just structural information
 */
export interface BrowserPattern {
  id: string;

  // Domain/page context (no full URLs)
  domain: string;                    // "tiktok.com"
  pathPattern: string;               // "/live/*" (wildcarded)

  // Viewport context for responsive patterns
  viewport: {
    widthRange: [number, number];    // [1800, 1920] - bucket ranges
    heightRange: [number, number];   // [1000, 1080]
    breakpoint: ViewportBreakpoint;
  };

  // Intent matching
  intentText: string;                // "send button", "comment input"
  actionType: LearnableAction;

  // Learned selector (structural, no content)
  selector: {
    role?: string;                   // "button", "textbox"
    namePattern?: string;            // "Send|Post|Submit" (regex)
    ariaLabel?: string;              // "Send message"
    dataTestId?: string;             // data-e2e="send-btn"
    cssHint?: string;                // "[data-testid='send']"

    // Relative coordinates (resolution-agnostic)
    relativeX?: number;              // 0.0-1.0 (percentage of viewport)
    relativeY?: number;              // 0.0-1.0
    quadrant?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  };

  // A11y fallback info
  a11y?: {
    role: string;
    name: string;
    backendNodeIdHint?: number;      // CDP backend node hint (may be stale)
  };

  // Confidence metrics (updated by feedback)
  successCount: number;
  failCount: number;
  confidence: number;                // successCount / total

  // Timestamps
  createdAt: number;
  lastUsed: number;
  lastFeedback?: ActionFeedback;
}

/**
 * User consent preferences per domain/pattern
 */
export interface ConsentPreference {
  domain: string;
  level: ConsentLevel;
  allowedActions?: LearnableAction[];
  createdAt: number;
  expiresAt?: number;                // Optional expiry
}

/**
 * Pending action awaiting user consent
 */
export interface PendingAction {
  id: string;
  jobId: string;
  action: LearnableAction;
  description: string;               // Human-readable description
  domain: string;
  url: string;

  // Element info for highlighting
  selector?: string;
  coordinates?: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };

  // Pattern match info (if using cached pattern)
  matchedPattern?: BrowserPattern;
  patternConfidence?: number;

  createdAt: number;
  expiresAt: number;                 // Auto-reject after timeout
}

/**
 * Action result awaiting feedback
 */
export interface PendingFeedback {
  id: string;
  jobId: string;
  action: LearnableAction;
  description: string;
  domain: string;

  // Result info
  success: boolean;
  result?: unknown;
  error?: string;

  // Selector used (for learning)
  selectorUsed?: {
    type: 'css' | 'a11y' | 'coordinates' | 'pattern';
    value: string;
    coordinates?: { x: number; y: number };
    screenshotDimensions?: { width: number; height: number };
  };

  // Viewport at time of action
  viewport?: {
    width: number;
    height: number;
  };

  createdAt: number;
  expiresAt: number;                 // Auto-dismiss (assumed good) after timeout
}

/**
 * Storage schema for chrome.storage.local
 */
export interface PatternStorage {
  patterns: BrowserPattern[];
  consents: ConsentPreference[];
  pendingActions: PendingAction[];
  pendingFeedback: PendingFeedback[];

  // Settings
  settings: {
    autoApproveConfidenceThreshold: number;  // e.g., 0.9 = auto-approve if confidence >= 90%
    feedbackTimeoutMs: number;               // Auto-dismiss feedback after this time
    consentTimeoutMs: number;                // Auto-reject action after this time
    maxStoredPatterns: number;               // Limit pattern storage
    enableLearning: boolean;                 // Master switch for pattern learning
  };

  // Stats
  stats: {
    totalActions: number;
    successfulActions: number;
    patternHits: number;                     // Actions that used cached patterns
    llmCalls: number;                        // Actions that needed LLM/vision
    feedbackCollected: number;
  };
}

/**
 * Default storage values
 */
export const DEFAULT_PATTERN_STORAGE: PatternStorage = {
  patterns: [],
  consents: [],
  pendingActions: [],
  pendingFeedback: [],
  settings: {
    autoApproveConfidenceThreshold: 0.9,
    feedbackTimeoutMs: 10000,                // 10 seconds
    consentTimeoutMs: 60000,                 // 60 seconds
    maxStoredPatterns: 1000,
    enableLearning: true,
  },
  stats: {
    totalActions: 0,
    successfulActions: 0,
    patternHits: 0,
    llmCalls: 0,
    feedbackCollected: 0,
  },
};

/**
 * Messages between background/popup for consent/feedback flow
 */
export interface ConsentRequestMessage {
  type: 'CONSENT_REQUEST';
  payload: PendingAction;
}

export interface ConsentResponseMessage {
  type: 'CONSENT_RESPONSE';
  payload: {
    actionId: string;
    approved: boolean;
    rememberForDomain?: boolean;
    rememberForPattern?: boolean;
  };
}

export interface FeedbackRequestMessage {
  type: 'FEEDBACK_REQUEST';
  payload: PendingFeedback;
}

export interface FeedbackResponseMessage {
  type: 'FEEDBACK_RESPONSE';
  payload: {
    feedbackId: string;
    feedback: ActionFeedback;
  };
}

export type PatternMessage =
  | ConsentRequestMessage
  | ConsentResponseMessage
  | FeedbackRequestMessage
  | FeedbackResponseMessage;
