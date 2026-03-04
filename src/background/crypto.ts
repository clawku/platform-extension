/**
 * Ed25519 signing for browser extension
 * Similar to platform-client's device signing
 */
import * as ed from '@noble/ed25519';

// Use synchronous SHA-512 from Web Crypto
ed.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const merged = new Uint8Array(messages.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of messages) {
    merged.set(m, offset);
    offset += m.length;
  }
  // Use crypto.subtle for SHA-512
  // Note: This is async, but we'll handle it in the caller
  throw new Error('Use async methods');
};

// Async SHA-512 using Web Crypto
async function sha512(message: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-512', message);
  return new Uint8Array(hash);
}

// Configure ed25519 to use async SHA-512
ed.etc.sha512Async = async (...messages: Uint8Array[]): Promise<Uint8Array> => {
  const merged = new Uint8Array(messages.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of messages) {
    merged.set(m, offset);
    offset += m.length;
  }
  return sha512(merged);
};

const STORAGE_KEY_PRIVATE = 'signingPrivateKey';
const STORAGE_KEY_PUBLIC = 'signingPublicKey';

// Convert bytes to base64
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 to bytes
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Convert public key to PEM format (for compatibility with server)
function publicKeyToPem(publicKey: Uint8Array): string {
  // Ed25519 public key in SubjectPublicKeyInfo format
  // OID for Ed25519: 1.3.101.112
  const prefix = new Uint8Array([
    0x30, 0x2a, // SEQUENCE, 42 bytes
    0x30, 0x05, // SEQUENCE, 5 bytes (AlgorithmIdentifier)
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
    0x03, 0x21, 0x00, // BIT STRING, 33 bytes (0x00 is padding bits count)
  ]);

  const spki = new Uint8Array(prefix.length + publicKey.length);
  spki.set(prefix);
  spki.set(publicKey, prefix.length);

  const base64 = bytesToBase64(spki);
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

export interface SigningKeyInfo {
  publicKeyB64: string;
  publicKeyPem: string;
}

/**
 * Ensure signing keypair exists, generate if not
 */
export async function ensureSigningKey(): Promise<SigningKeyInfo> {
  const storage = await chrome.storage.local.get([STORAGE_KEY_PRIVATE, STORAGE_KEY_PUBLIC]);

  if (storage[STORAGE_KEY_PRIVATE] && storage[STORAGE_KEY_PUBLIC]) {
    const publicKey = base64ToBytes(storage[STORAGE_KEY_PUBLIC]);
    return {
      publicKeyB64: storage[STORAGE_KEY_PUBLIC],
      publicKeyPem: publicKeyToPem(publicKey),
    };
  }

  // Generate new keypair
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  const privateKeyB64 = bytesToBase64(privateKey);
  const publicKeyB64 = bytesToBase64(publicKey);

  await chrome.storage.local.set({
    [STORAGE_KEY_PRIVATE]: privateKeyB64,
    [STORAGE_KEY_PUBLIC]: publicKeyB64,
  });

  console.log('[Crypto] Generated new signing keypair');

  return {
    publicKeyB64,
    publicKeyPem: publicKeyToPem(publicKey),
  };
}

/**
 * Sign a message with the extension's private key
 */
export async function signMessage(message: string): Promise<string> {
  const storage = await chrome.storage.local.get([STORAGE_KEY_PRIVATE]);

  if (!storage[STORAGE_KEY_PRIVATE]) {
    throw new Error('No signing key available');
  }

  const privateKey = base64ToBytes(storage[STORAGE_KEY_PRIVATE]);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await ed.signAsync(messageBytes, privateKey);

  return bytesToBase64(signature);
}

/**
 * Get the stored public key
 */
export async function getPublicKey(): Promise<SigningKeyInfo | null> {
  const storage = await chrome.storage.local.get([STORAGE_KEY_PUBLIC]);

  if (!storage[STORAGE_KEY_PUBLIC]) {
    return null;
  }

  const publicKey = base64ToBytes(storage[STORAGE_KEY_PUBLIC]);
  return {
    publicKeyB64: storage[STORAGE_KEY_PUBLIC],
    publicKeyPem: publicKeyToPem(publicKey),
  };
}

/**
 * Clear signing keys (on disconnect)
 */
export async function clearSigningKeys(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY_PRIVATE, STORAGE_KEY_PUBLIC]);
  console.log('[Crypto] Cleared signing keys');
}
