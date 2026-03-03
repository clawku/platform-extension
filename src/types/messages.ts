// WebSocket message types between platform-api and extension

// OpenClaw browser tool actions (compatible with browser-tool.ts)
export type BrowserAction =
  | 'status'
  | 'tabs'
  | 'open'
  | 'close'
  | 'focus'
  | 'navigate'
  | 'screenshot'
  | 'snapshot'
  | 'console'
  // OpenClaw uses 'act' wrapper for all interactions
  | 'act'
  // Direct actions (legacy support)
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'select'
  // Unsupported actions (return helpful errors)
  | 'start'
  | 'stop'
  | 'profiles'
  | 'pdf'
  | 'upload'
  | 'dialog';

// OpenClaw act kinds (from browser-tool.schema.ts)
export type BrowserActKind =
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'drag'
  | 'select'
  | 'fill'
  | 'resize'
  | 'wait'
  | 'evaluate'
  | 'close'
  | 'scroll';

export interface BrowserJobPayload {
  jobId: string;
  action: BrowserAction;
  params: BrowserActionParams;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

// OpenClaw act request object (nested form)
export interface BrowserActRequest {
  kind: BrowserActKind;
  targetId?: string;
  ref?: string;
  // click
  doubleClick?: boolean;
  button?: string;
  modifiers?: string[];
  // type
  text?: string;
  submit?: boolean;
  slowly?: boolean;
  // press
  key?: string;
  delayMs?: number;
  // drag
  startRef?: string;
  endRef?: string;
  // select
  values?: string[];
  // fill
  fields?: Array<Record<string, unknown>>;
  // resize
  width?: number;
  height?: number;
  // wait
  timeMs?: number;
  selector?: string;
  url?: string;
  loadState?: string;
  textGone?: string;
  timeoutMs?: number;
  // evaluate
  fn?: string;
  // scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export interface BrowserActionParams {
  // Common
  targetId?: number; // Tab ID
  ref?: string; // Element reference from snapshot

  // open/navigate
  url?: string;
  targetUrl?: string; // OpenClaw uses targetUrl for open/navigate

  // click
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
  modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];

  // type
  text?: string;
  submit?: boolean;
  slowly?: boolean;

  // press
  key?: string;
  delayMs?: number;

  // scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;

  // select
  values?: string[];

  // screenshot
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  element?: string; // CSS selector for element screenshot

  // snapshot
  snapshotFormat?: 'ai' | 'aria';
  maxChars?: number;
  limit?: number;
  mode?: 'efficient';
  refs?: 'role' | 'aria';
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
  frame?: string;
  labels?: boolean;

  // console
  level?: 'log' | 'warn' | 'error' | 'all';

  // act - OpenClaw wraps interactions in 'act' action
  kind?: BrowserActKind; // Flattened form: action=act, kind=click, ref=e12
  request?: BrowserActRequest; // Nested form: action=act, request={kind: 'click', ref: 'e12'}

  // wait
  timeMs?: number;
  loadState?: string;
  textGone?: string;
  timeoutMs?: number;

  // drag
  startRef?: string;
  endRef?: string;

  // fill
  fields?: Array<Record<string, unknown>>;

  // resize
  width?: number;
  height?: number;

  // evaluate
  fn?: string;
}

export interface BrowserResultPayload {
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  result?: unknown;
  errorText?: string;
  nonce: string;
  issuedAt: number;
}

export interface WebSocketMessage {
  type: string;
  payload: unknown;
}

// Messages from platform-api to extension
export interface BrowserJobMessage extends WebSocketMessage {
  type: 'browser.job';
  payload: BrowserJobPayload;
}

// Messages from extension to platform-api
export interface BrowserResultMessage extends WebSocketMessage {
  type: 'browser.result';
  payload: BrowserResultPayload;
}

// Extension storage
export interface ExtensionStorage {
  token?: string;
  userId?: string;
  personaId?: string;
  personaName?: string;
  apiBaseUrl?: string;
  wsBaseUrl?: string;
  pairedAt?: number;
}

// Content script messages
export interface ContentScriptMessage {
  type: 'EXECUTE_ACTION' | 'GET_SNAPSHOT' | 'PING';
  payload?: unknown;
}

export interface ContentScriptResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// Popup messages to background
export interface PopupMessage {
  type: 'GET_STATUS' | 'PAIR' | 'DISCONNECT' | 'RECONNECT';
  payload?: {
    code?: string;
    apiBaseUrl?: string;
  };
}

export interface ConnectionStatus {
  paired: boolean;
  connected: boolean;
  personaName?: string;
  lastSeen?: number;
  error?: string;
}
