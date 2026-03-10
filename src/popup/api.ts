/**
 * Chat API Client for Extension Popup
 * Handles chat and orchestration API calls
 */

import type { ExtensionStorage } from '../types/messages.js';

// API response types
export interface Persona {
  id: string;
  name: string;
  vibe?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  personaId?: string;
  personaName?: string;
  createdAt?: string;
}

export interface OrchestrationRoom {
  id: string;
  name: string | null;
  messageCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface OrchestrationMessage {
  id: string;
  role: 'user' | 'assistant';
  personaId: string | null;
  personaName: string | null;
  content: string;
  createdAt: string;
}

// Get stored credentials
async function getCredentials(): Promise<{ token: string; apiBaseUrl: string } | null> {
  const storage = (await chrome.storage.local.get([
    'token',
    'apiBaseUrl',
  ])) as ExtensionStorage;

  if (!storage.token || !storage.apiBaseUrl) {
    return null;
  }

  return { token: storage.token, apiBaseUrl: storage.apiBaseUrl };
}

// API fetch helper
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const creds = await getCredentials();
  if (!creds) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${creds.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `API error (${response.status})`);
  }

  return response.json();
}

// ============ Personas API ============

export async function listPersonas(): Promise<Persona[]> {
  const data = await apiFetch<{ personas: Persona[] }>('/browser/personas');
  return data.personas;
}

// ============ Chat API ============

export async function getChatHistory(personaId: string): Promise<ChatMessage[]> {
  const data = await apiFetch<{ messages: ChatMessage[] }>(
    `/browser/chat/history/${personaId}`
  );
  return data.messages;
}

export async function clearChatSession(personaId: string): Promise<void> {
  await apiFetch(`/browser/chat/session/${personaId}`, { method: 'DELETE' });
}

// ============ File Attachments ============

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface ChatAttachment {
  cloudFileId?: string;
  base64?: string;
  filename: string;
  mimeType: string;
}

// Maximum file size for inline base64 (larger files go through upload endpoint)
const MAX_INLINE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Upload a file for chat attachment
 * Returns the uploaded file metadata
 */
export async function uploadFileForChat(file: File): Promise<UploadedFile> {
  const creds = await getCredentials();
  if (!creds) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${creds.apiBaseUrl}/browser/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || `Upload failed (${response.status})`);
  }

  return response.json();
}

/**
 * Prepare a file for sending as attachment
 * Small files (<2MB) are converted to base64 inline
 * Larger files are uploaded and referenced by ID
 */
export async function prepareFileAttachment(file: File): Promise<ChatAttachment> {
  if (file.size <= MAX_INLINE_SIZE) {
    // Small file: convert to base64
    const base64 = await fileToBase64(file);
    return {
      base64,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
    };
  } else {
    // Large file: upload first, then reference
    const uploaded = await uploadFileForChat(file);
    return {
      cloudFileId: uploaded.id,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
    };
  }
}

/**
 * Convert File to base64 string
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============ Orchestration API ============

export async function createOrchestrationRoom(
  name?: string
): Promise<OrchestrationRoom> {
  return apiFetch('/browser/orchestration/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listOrchestrationRooms(): Promise<OrchestrationRoom[]> {
  const data = await apiFetch<{ rooms: OrchestrationRoom[] }>(
    '/browser/orchestration/rooms'
  );
  return data.rooms;
}

export async function getOrchestrationRoom(roomId: string): Promise<{
  room: OrchestrationRoom;
  messages: OrchestrationMessage[];
}> {
  const data = await apiFetch<{
    id: string;
    name: string | null;
    messages: OrchestrationMessage[];
  }>(`/browser/orchestration/rooms/${roomId}`);

  return {
    room: { id: data.id, name: data.name, createdAt: '' },
    messages: data.messages,
  };
}

export async function deleteOrchestrationRoom(roomId: string): Promise<void> {
  await apiFetch(`/browser/orchestration/rooms/${roomId}`, { method: 'DELETE' });
}

export async function clearOrchestrationRoomMessages(
  roomId: string
): Promise<void> {
  await apiFetch(`/browser/orchestration/rooms/${roomId}/messages`, {
    method: 'DELETE',
  });
}

// ============ WebSocket Chat ============

export interface ChatWebSocketCallbacks {
  onStart?: (data: { messageType: 'chat' | 'orchestration'; personaId?: string }) => void;
  onChunk?: (data: { personaId?: string; personaName?: string; content: string }) => void;
  onComplete?: (data: { personaId?: string; personaName?: string; fullResponse: string }) => void;
  onDone?: (data: { totalPersonas?: number }) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

let chatWebSocket: WebSocket | null = null;
let chatCallbacks: ChatWebSocketCallbacks = {};
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let isIntentionalDisconnect = false;

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds

function getReconnectDelay(): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  return delay;
}

async function attemptReconnect(): Promise<void> {
  if (isIntentionalDisconnect) {
    console.log('[ChatWS] Intentional disconnect, not reconnecting');
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('[ChatWS] Max reconnect attempts reached');
    chatCallbacks.onError?.('Connection lost. Please refresh to reconnect.');
    return;
  }

  const delay = getReconnectDelay();
  console.log(`[ChatWS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  reconnectTimeout = setTimeout(async () => {
    reconnectAttempts++;
    try {
      await connectChatWebSocketInternal();
    } catch (error) {
      console.error('[ChatWS] Reconnect failed:', error);
      attemptReconnect();
    }
  }, delay);
}

async function connectChatWebSocketInternal(): Promise<void> {
  const creds = await getCredentials();
  if (!creds) {
    chatCallbacks.onError?.('Not authenticated');
    return;
  }

  const wsUrl = creds.apiBaseUrl
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');

  chatWebSocket = new WebSocket(`${wsUrl}/ws/chat?token=${creds.token}`);

  chatWebSocket.onopen = () => {
    console.log('[ChatWS] Connected');
    reconnectAttempts = 0; // Reset on successful connection
    chatCallbacks.onConnect?.();

    // Start ping interval
    pingInterval = setInterval(() => {
      if (chatWebSocket?.readyState === WebSocket.OPEN) {
        chatWebSocket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };

  chatWebSocket.onclose = (event) => {
    console.log('[ChatWS] Disconnected', event.code, event.reason);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    chatCallbacks.onDisconnect?.();

    // Auto-reconnect unless intentionally disconnected
    if (!isIntentionalDisconnect) {
      attemptReconnect();
    }
  };

  chatWebSocket.onerror = (event) => {
    console.error('[ChatWS] Error:', event);
    // Don't call onError here - onclose will be called after onerror
    // and will handle reconnection
  };

  chatWebSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'start':
          chatCallbacks.onStart?.(data);
          break;
        case 'chunk':
          chatCallbacks.onChunk?.(data);
          break;
        case 'complete':
          chatCallbacks.onComplete?.(data);
          break;
        case 'done':
          chatCallbacks.onDone?.(data);
          break;
        case 'error':
          chatCallbacks.onError?.(data.error || 'Unknown error');
          break;
        case 'pong':
          // Heartbeat response, ignore
          break;
        default:
          console.log('[ChatWS] Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('[ChatWS] Failed to parse message:', error);
    }
  };
}

export async function connectChatWebSocket(
  callbacks: ChatWebSocketCallbacks
): Promise<void> {
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Close existing connection
  isIntentionalDisconnect = true;
  disconnectChatWebSocket();
  isIntentionalDisconnect = false;

  reconnectAttempts = 0;
  chatCallbacks = callbacks;

  await connectChatWebSocketInternal();
}

export function disconnectChatWebSocket(): void {
  isIntentionalDisconnect = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (chatWebSocket) {
    chatWebSocket.close();
    chatWebSocket = null;
  }

  reconnectAttempts = 0;
}

export function isChatWebSocketConnected(): boolean {
  return chatWebSocket?.readyState === WebSocket.OPEN;
}

export function isChatWebSocketReconnecting(): boolean {
  return reconnectTimeout !== null || (reconnectAttempts > 0 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS);
}

export function getReconnectStatus(): { reconnecting: boolean; attempt: number; maxAttempts: number } {
  return {
    reconnecting: isChatWebSocketReconnecting(),
    attempt: reconnectAttempts,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
  };
}

export function sendChatMessageWS(
  personaId: string,
  message: string,
  attachments?: ChatAttachment[]
): void {
  if (!chatWebSocket || chatWebSocket.readyState !== WebSocket.OPEN) {
    chatCallbacks.onError?.('WebSocket not connected');
    return;
  }

  chatWebSocket.send(
    JSON.stringify({
      type: 'chat',
      personaId,
      message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      source: 'browser_extension', // Indicate message is from extension
    })
  );
}

export function sendOrchestrationMessageWS(
  roomId: string,
  message: string,
  attachments?: ChatAttachment[]
): void {
  if (!chatWebSocket || chatWebSocket.readyState !== WebSocket.OPEN) {
    chatCallbacks.onError?.('WebSocket not connected');
    return;
  }

  chatWebSocket.send(
    JSON.stringify({
      type: 'orchestration',
      roomId,
      message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      source: 'browser_extension', // Indicate message is from extension
    })
  );
}
