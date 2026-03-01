import type { ConnectionStatus, PopupMessage } from '../types/messages.js';

// Elements
const stateLoading = document.getElementById('state-loading')!;
const stateUnpaired = document.getElementById('state-unpaired')!;
const stateConnected = document.getElementById('state-connected')!;
const stateDisconnected = document.getElementById('state-disconnected')!;
const stateError = document.getElementById('state-error')!;

const inputPairingCode = document.getElementById('pairing-code') as HTMLInputElement;
const inputApiUrl = document.getElementById('api-url') as HTMLInputElement;
const personaName = document.getElementById('persona-name')!;
const personaNameDisconnected = document.getElementById('persona-name-disconnected')!;
const errorText = document.getElementById('error-text')!;

const btnPair = document.getElementById('btn-pair')!;
const btnTest = document.getElementById('btn-test')!;
const btnDisconnect = document.getElementById('btn-disconnect')!;
const btnDisconnect2 = document.getElementById('btn-disconnect-2')!;
const btnReconnect = document.getElementById('btn-reconnect')!;
const btnRetry = document.getElementById('btn-retry')!;

// State management
function showState(state: 'loading' | 'unpaired' | 'connected' | 'disconnected' | 'error') {
  stateLoading.classList.add('hidden');
  stateUnpaired.classList.add('hidden');
  stateConnected.classList.add('hidden');
  stateDisconnected.classList.add('hidden');
  stateError.classList.add('hidden');

  switch (state) {
    case 'loading':
      stateLoading.classList.remove('hidden');
      break;
    case 'unpaired':
      stateUnpaired.classList.remove('hidden');
      break;
    case 'connected':
      stateConnected.classList.remove('hidden');
      break;
    case 'disconnected':
      stateDisconnected.classList.remove('hidden');
      break;
    case 'error':
      stateError.classList.remove('hidden');
      break;
  }
}

function showError(message: string) {
  errorText.textContent = message;
  showState('error');
}

async function sendMessage(message: PopupMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

// Load initial state
async function loadStatus() {
  showState('loading');

  try {
    const status = (await sendMessage({ type: 'GET_STATUS' })) as ConnectionStatus;

    if (!status.paired) {
      showState('unpaired');
      return;
    }

    if (status.connected) {
      personaName.textContent = status.personaName || 'Unknown Persona';
      showState('connected');
    } else {
      personaNameDisconnected.textContent = status.personaName || 'Unknown Persona';
      showState('disconnected');
    }
  } catch (error) {
    showError('Failed to load status');
  }
}

// Pair with code
async function handlePair() {
  const code = inputPairingCode.value.trim();
  if (!code || code.length < 6) {
    showError('Please enter a valid 6-digit code');
    return;
  }

  const apiUrl = inputApiUrl.value.trim() || undefined;

  btnPair.textContent = 'Connecting...';
  btnPair.setAttribute('disabled', 'true');

  try {
    const result = (await sendMessage({
      type: 'PAIR',
      payload: { code, apiBaseUrl: apiUrl },
    })) as { success: boolean; error?: string };

    if (result.success) {
      await loadStatus();
    } else {
      showError(result.error || 'Pairing failed');
    }
  } catch (error) {
    showError('Connection error');
  } finally {
    btnPair.textContent = 'Connect';
    btnPair.removeAttribute('disabled');
  }
}

// Disconnect
async function handleDisconnect() {
  try {
    await sendMessage({ type: 'DISCONNECT' });
    inputPairingCode.value = '';
    showState('unpaired');
  } catch (error) {
    showError('Failed to disconnect');
  }
}

// Reconnect
async function handleReconnect() {
  btnReconnect.textContent = 'Connecting...';
  btnReconnect.setAttribute('disabled', 'true');

  try {
    const result = (await sendMessage({ type: 'RECONNECT' })) as {
      success: boolean;
      error?: string;
    };

    if (result.success) {
      await loadStatus();
    } else {
      showError(result.error || 'Reconnection failed');
    }
  } catch (error) {
    showError('Connection error');
  } finally {
    btnReconnect.textContent = 'Reconnect Now';
    btnReconnect.removeAttribute('disabled');
  }
}

// Test connection
async function handleTest() {
  btnTest.textContent = 'Testing...';
  btnTest.setAttribute('disabled', 'true');

  try {
    // Get current tab and take a screenshot
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError('No active tab');
      return;
    }

    // Send test message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });

    if (response?.success) {
      btnTest.textContent = 'Working!';
      setTimeout(() => {
        btnTest.textContent = 'Test Connection';
      }, 2000);
    } else {
      btnTest.textContent = 'Test Failed';
      setTimeout(() => {
        btnTest.textContent = 'Test Connection';
      }, 2000);
    }
  } catch (error) {
    // Content script might not be loaded on this page
    btnTest.textContent = 'N/A on this page';
    setTimeout(() => {
      btnTest.textContent = 'Test Connection';
    }, 2000);
  } finally {
    btnTest.removeAttribute('disabled');
  }
}

// Event listeners
btnPair.addEventListener('click', handlePair);
btnDisconnect.addEventListener('click', handleDisconnect);
btnDisconnect2.addEventListener('click', handleDisconnect);
btnReconnect.addEventListener('click', handleReconnect);
btnTest.addEventListener('click', handleTest);
btnRetry.addEventListener('click', loadStatus);

// Auto-uppercase pairing code
inputPairingCode.addEventListener('input', () => {
  inputPairingCode.value = inputPairingCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Enter key to submit
inputPairingCode.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handlePair();
  }
});

// Initialize
loadStatus();
