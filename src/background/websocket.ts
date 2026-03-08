import type {
  WebSocketMessage,
  BrowserJobMessage,
  BrowserResultPayload,
  ExtensionStorage,
} from '../types/messages.js';
import { signMessage } from './crypto.js';

type MessageHandler = (message: BrowserJobMessage) => void;

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

class WebSocketConnection {
  private messageHandler: MessageHandler | null = null;
  private storage: ExtensionStorage | null = null;
  private offscreenCreated = false;
  private _isConnected = false;

  constructor() {
    // Listen for messages from offscreen document
    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (message.type === 'WS_CONNECTED') {
        console.log('[WebSocket] Offscreen reports connected');
        this._isConnected = true;
        this.updateBadge('connected');
        chrome.storage.local.set({ wsConnected: true });
      } else if (message.type === 'WS_DISCONNECTED') {
        console.log('[WebSocket] Offscreen reports disconnected');
        this._isConnected = false;
        this.updateBadge('disconnected');
        chrome.storage.local.set({ wsConnected: false });
      } else if (message.type === 'WS_MESSAGE' && message.data) {
        this.handleMessage(message.data);
      } else if (message.type === 'WS_ERROR') {
        this.updateBadge('error');
      }
      return false;
    });
  }

  private async ensureOffscreenDocument(): Promise<void> {
    if (this.offscreenCreated) return;

    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });

    if (existingContexts.length > 0) {
      this.offscreenCreated = true;
      return;
    }

    // Create offscreen document - use BLOBS reason which allows network access
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Maintain persistent WebSocket connection to Clawku server',
    });
    this.offscreenCreated = true;
    console.log('[WebSocket] Offscreen document created');
  }

  async connect(manual = false): Promise<boolean> {
    // Load storage
    const result = await chrome.storage.local.get([
      'token',
      'wsBaseUrl',
      'personaId',
    ]);
    this.storage = result as ExtensionStorage;

    if (!this.storage.token) {
      console.log('[WebSocket] No token found, not connecting');
      return false;
    }

    const wsUrl = this.storage.wsBaseUrl || 'wss://api.b.clawku.id';

    try {
      await this.ensureOffscreenDocument();

      // Send connect message to offscreen document
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'CONNECT',
        wsUrl,
        token: this.storage.token,
      });

      if (response?.success) {
        this._isConnected = true;
        this.updateBadge('connected');
        return true;
      } else {
        console.error('[WebSocket] Offscreen connect failed:', response?.error);
        return false;
      }
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      return false;
    }
  }

  private handleMessage(data: WebSocketMessage) {
    console.log('[WebSocket] Received:', data.type);

    if (data.type === 'browser.job' && this.messageHandler) {
      this.messageHandler(data as BrowserJobMessage);
    } else if (data.type === 'pong') {
      // Heartbeat response - offscreen handles ping/pong
    }
  }

  async sendResult(payload: BrowserResultPayload): Promise<boolean> {
    if (!this._isConnected) {
      console.error('[WebSocket] Cannot send - not connected');
      return false;
    }

    try {
      // Create the payload JSON for signing
      const payloadJson = JSON.stringify(payload);

      // Sign the payload
      const signature = await signMessage(payloadJson);

      const message = {
        type: 'browser.result',
        payload,
        signature,
      };

      // Send via offscreen document
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'SEND',
        data: message,
      });

      if (response?.success) {
        console.log('[WebSocket] Sent signed result for job:', payload.jobId);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[WebSocket] Failed to send message:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'DISCONNECT',
      });
    } catch (e) {
      // Offscreen might not exist
    }
    this._isConnected = false;
    this.updateBadge('disconnected');
  }

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  private updateBadge(status: 'connected' | 'disconnected' | 'error') {
    const colors: Record<string, string> = {
      connected: '#22c55e', // Green
      disconnected: '#f59e0b', // Yellow
      error: '#ef4444', // Red
    };

    const text: Record<string, string> = {
      connected: 'ON',
      disconnected: '',
      error: '!',
    };

    chrome.action.setBadgeBackgroundColor({ color: colors[status] });
    chrome.action.setBadgeText({ text: text[status] });
  }
}

export const wsConnection = new WebSocketConnection();
