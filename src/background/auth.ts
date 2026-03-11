import type { ExtensionStorage, ConnectionStatus } from '../types/messages.js';
import { ensureSigningKey, clearSigningKeys } from './crypto.js';

const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_WS_URL = 'ws://localhost:3000';

export async function pair(
  code: string,
  apiBaseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = apiBaseUrl || DEFAULT_API_URL;

  try {
    // Generate signing keypair for this extension
    const signingKey = await ensureSigningKey();
    console.log('[Auth] Generated signing key');

    const response = await fetch(`${baseUrl}/browser/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        signingPublicKey: signingKey.publicKeyPem,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // Clear signing keys on failed pairing
      await clearSigningKeys();
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
    // Clear signing keys on error
    await clearSigningKeys();
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

  // Clear signing keys
  await clearSigningKeys();
  await chrome.storage.local.clear();
  console.log('[Auth] Disconnected and cleared storage');
}

export async function getStatus(): Promise<ConnectionStatus> {
  const storage = (await chrome.storage.local.get([
    'token',
    'personaName',
    'pairedAt',
    'userId',
    'apiBaseUrl',
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
    userEmail: storage.userId,
    extensionId: chrome.runtime.id,
    apiUrl: storage.apiBaseUrl || 'https://api.clawku.ai',
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
