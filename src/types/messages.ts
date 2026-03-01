// WebSocket message types between platform-api and extension

export type BrowserAction =
  | 'status'
  | 'tabs'
  | 'open'
  | 'close'
  | 'focus'
  | 'navigate'
  | 'screenshot'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'select'
  | 'console';

export interface BrowserJobPayload {
  jobId: string;
  action: BrowserAction;
  params: BrowserActionParams;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface BrowserActionParams {
  // Common
  targetId?: number; // Tab ID
  ref?: string; // Element reference from snapshot

  // open/navigate
  url?: string;

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

  // scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;

  // select
  values?: string[];

  // screenshot
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;

  // snapshot
  snapshotFormat?: 'ai' | 'aria';
  maxChars?: number;

  // console
  level?: 'log' | 'warn' | 'error' | 'all';
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
