import type { ExtensionStorage, ConnectionStatus } from '../types/messages.js';

const DEFAULT_API_URL = 'https://api.clawku.ai';
const DEFAULT_WS_URL = 'wss://api.clawku.ai';

export async function pair(
  code: string,
  apiBaseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = apiBaseUrl || DEFAULT_API_URL;

  try {
    const response = await fetch(`${baseUrl}/browser/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.message || `Pairing failed (${response.status})`,
      };
    }

    const data = await response.json();

    // Store credentials
    const storage: ExtensionStorage = {
      token: data.token,
      userId: data.userId,
      personaId: data.personaId,
      personaName: data.personaName,
      apiBaseUrl: baseUrl,
      wsBaseUrl: baseUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
      pairedAt: Date.now(),
    };

    await chrome.storage.local.set(storage);
    console.log('[Auth] Paired successfully with persona:', data.personaName);

    return { success: true };
  } catch (error) {
    console.error('[Auth] Pairing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export async function disconnect(): Promise<void> {
  const storage = await chrome.storage.local.get(['token', 'apiBaseUrl']);

  if (storage.token && storage.apiBaseUrl) {
    try {
      await fetch(`${storage.apiBaseUrl}/browser/disconnect`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${storage.token}`,
        },
      });
    } catch (error) {
      console.error('[Auth] Disconnect API error:', error);
    }
  }

  await chrome.storage.local.clear();
  console.log('[Auth] Disconnected and cleared storage');
}

export async function getStatus(): Promise<ConnectionStatus> {
  const storage = (await chrome.storage.local.get([
    'token',
    'personaName',
    'pairedAt',
  ])) as ExtensionStorage;

  if (!storage.token) {
    return {
      paired: false,
      connected: false,
    };
  }

  // Check if WebSocket is connected (will be set by service worker)
  const wsStatus = await chrome.storage.local.get(['wsConnected']);

  return {
    paired: true,
    connected: wsStatus.wsConnected === true,
    personaName: storage.personaName,
    lastSeen: storage.pairedAt,
  };
}

export async function getStoredCredentials(): Promise<ExtensionStorage | null> {
  const storage = (await chrome.storage.local.get([
    'token',
    'userId',
    'personaId',
    'personaName',
    'apiBaseUrl',
    'wsBaseUrl',
    'pairedAt',
  ])) as ExtensionStorage;

  if (!storage.token) {
    return null;
  }

  return storage;
}
