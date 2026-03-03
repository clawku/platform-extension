import type {
  WebSocketMessage,
  BrowserJobMessage,
  BrowserResultPayload,
  ExtensionStorage,
} from '../types/messages.js';

type MessageHandler = (message: BrowserJobMessage) => void;

class WebSocketConnection {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private messageHandler: MessageHandler | null = null;
  private storage: ExtensionStorage | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isManualConnect = false;

  async connect(manual = false): Promise<boolean> {
    // Track if this is a manual connect (user clicked reconnect)
    this.isManualConnect = manual;

    // For manual reconnects, reset attempts counter to allow retries
    if (manual) {
      this.reconnectAttempts = 0;
      // Cancel any pending reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }

    // Close existing connection if any
    if (this.ws) {
      this.cleanup();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

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

    const wsUrl = this.storage.wsBaseUrl || 'wss://api.clawku.ai';
    const url = `${wsUrl}/browser/ws?token=${this.storage.token}`;

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      try {
        console.log('[WebSocket] Connecting to', wsUrl);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected');
          this.reconnectAttempts = 0;
          this.isManualConnect = false;
          this.startPing();
          this.updateBadge('connected');
          safeResolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('[WebSocket] Closed:', event.code, event.reason);
          this.cleanup();
          this.updateBadge('disconnected');
          // Always resolve the initial connect promise
          safeResolve(false);
          // Then schedule reconnect (only for auto-reconnects)
          if (!this.isManualConnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          this.updateBadge('error');
        };
      } catch (error) {
        console.error('[WebSocket] Connection error:', error);
        safeResolve(false);
      }
    });
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data) as WebSocketMessage;
      console.log('[WebSocket] Received:', message.type);

      if (message.type === 'browser.job' && this.messageHandler) {
        this.messageHandler(message as BrowserJobMessage);
      } else if (message.type === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  }

  sendResult(payload: BrowserResultPayload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WebSocket] Cannot send - not connected');
      return false;
    }

    const message = {
      type: 'browser.result',
      payload,
    };

    this.ws.send(JSON.stringify(message));
    console.log('[WebSocket] Sent result for job:', payload.jobId);
    return true;
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private cleanup() {
    this.stopPing();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WebSocket] Max reconnect attempts reached');
      this.updateBadge('error');
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      60000
    );
    this.reconnectAttempts++;

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
    this.cleanup();
    if (this.ws) {
      this.ws.close();
    }
    this.updateBadge('disconnected');
  }

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
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
