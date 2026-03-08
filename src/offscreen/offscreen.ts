/**
 * Offscreen document for maintaining persistent WebSocket connection
 * This runs separately from the service worker and doesn't get suspended
 */

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 20;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'CONNECT':
      connect(message.wsUrl, message.token).then(sendResponse);
      return true; // Will respond async

    case 'DISCONNECT':
      disconnect();
      sendResponse({ success: true });
      return false;

    case 'SEND':
      const sent = send(message.data);
      sendResponse({ success: sent });
      return false;

    case 'STATUS':
      sendResponse({
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        readyState: ws?.readyState ?? -1,
      });
      return false;
  }
});

async function connect(wsUrl: string, token: string): Promise<{ success: boolean; error?: string }> {
  // Close existing connection
  if (ws) {
    ws.close();
    ws = null;
  }

  const url = `${wsUrl}/browser/ws?token=${token}`;
  console.log('[Offscreen] Connecting to', wsUrl);

  return new Promise((resolve) => {
    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Offscreen] WebSocket connected');
        reconnectAttempts = 0;
        // Start ping interval to keep connection alive
        startPingInterval();
        // Notify service worker
        chrome.runtime.sendMessage({ type: 'WS_CONNECTED' });
        resolve({ success: true });
      };

      ws.onmessage = (event) => {
        // Forward message to service worker
        try {
          const data = JSON.parse(event.data);
          chrome.runtime.sendMessage({ type: 'WS_MESSAGE', data });
        } catch (e) {
          console.error('[Offscreen] Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[Offscreen] WebSocket closed:', event.code, event.reason);
        ws = null;
        stopPingInterval();
        chrome.runtime.sendMessage({ type: 'WS_DISCONNECTED', code: event.code });
        // Auto-reconnect with backoff
        scheduleReconnect(wsUrl, token);
      };

      ws.onerror = (error) => {
        console.error('[Offscreen] WebSocket error:', error);
        chrome.runtime.sendMessage({ type: 'WS_ERROR' });
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          resolve({ success: false, error: 'Connection timeout' });
        }
      }, 10000);

    } catch (error) {
      resolve({ success: false, error: String(error) });
    }
  });
}

function scheduleReconnect(wsUrl: string, token: string) {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log('[Offscreen] Max reconnect attempts reached');
    return;
  }

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
  reconnectAttempts++;
  console.log(`[Offscreen] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  setTimeout(() => {
    connect(wsUrl, token);
  }, delay);
}

function startPingInterval() {
  stopPingInterval();
  // Send ping every 25 seconds to keep server connection alive (server timeout is 60s)
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
      console.log('[Offscreen] Ping sent');
    }
  }, 25000);
}

function stopPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function disconnect() {
  reconnectAttempts = maxReconnectAttempts; // Prevent auto-reconnect
  stopPingInterval();
  if (ws) {
    ws.close();
    ws = null;
  }
}

function send(data: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[Offscreen] Cannot send - not connected');
    return false;
  }
  ws.send(JSON.stringify(data));
  return true;
}

console.log('[Offscreen] Document loaded, ready for WebSocket connection');
