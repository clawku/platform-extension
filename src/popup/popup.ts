import type { ConnectionStatus, PopupMessage } from '../types/messages.js';
import {
  listPersonas,
  getChatHistory,
  clearChatSession,
  listOrchestrationRooms,
  getOrchestrationRoom,
  createOrchestrationRoom,
  deleteOrchestrationRoom,
  clearOrchestrationRoomMessages,
  connectChatWebSocket,
  disconnectChatWebSocket,
  isChatWebSocketConnected,
  isChatWebSocketReconnecting,
  sendChatMessageWS,
  sendOrchestrationMessageWS,
  prepareFileAttachment,
  type Persona,
  type ChatMessage,
  type OrchestrationRoom,
  type OrchestrationMessage,
  type ChatAttachment,
} from './api.js';

// ============ Element References ============

// States
const stateLoading = document.getElementById('state-loading')!;
const stateUnpaired = document.getElementById('state-unpaired')!;
const stateConnected = document.getElementById('state-connected')!;
const stateDisconnected = document.getElementById('state-disconnected')!;
const stateError = document.getElementById('state-error')!;

// Tabs
const navTabs = document.getElementById('nav-tabs')!;
const tabControl = document.getElementById('tab-control')!;
const tabChat = document.getElementById('tab-chat')!;
const tabOrchestration = document.getElementById('tab-orchestration')!;

// Pairing inputs
const inputPairingCode = document.getElementById('pairing-code') as HTMLInputElement;
const inputApiUrl = document.getElementById('api-url') as HTMLInputElement;
const personaName = document.getElementById('persona-name')!;
const personaNameDisconnected = document.getElementById('persona-name-disconnected')!;
const errorText = document.getElementById('error-text')!;

// Control buttons
const btnPair = document.getElementById('btn-pair')!;
const btnTest = document.getElementById('btn-test')!;
const btnDisconnect = document.getElementById('btn-disconnect')!;
const btnDisconnect2 = document.getElementById('btn-disconnect-2')!;
const btnReconnect = document.getElementById('btn-reconnect')!;
const btnRetry = document.getElementById('btn-retry')!;

// Activity log
const activityLog = document.getElementById('activity-log')!;
const activityList = document.getElementById('activity-list')!;

// Chat elements
const personaSelect = document.getElementById('persona-select') as HTMLSelectElement;
const btnClearChat = document.getElementById('btn-clear-chat')!;
const chatMessages = document.getElementById('chat-messages')!;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const btnSendChat = document.getElementById('btn-send-chat')!;

// Orchestration elements
const roomSelect = document.getElementById('room-select') as HTMLSelectElement;
const btnRoomMenu = document.getElementById('btn-room-menu')!;
const roomMenu = document.getElementById('room-menu')!;
const btnClearRoom = document.getElementById('btn-clear-room')!;
const btnDeleteRoom = document.getElementById('btn-delete-room')!;
const orchestrationMessages = document.getElementById('orchestration-messages')!;
const orchestrationInput = document.getElementById('orchestration-input') as HTMLTextAreaElement;
const btnSendOrchestration = document.getElementById('btn-send-orchestration')!;

// Chat attachment elements
const btnAttachChat = document.getElementById('btn-attach-chat')!;
const chatFileInput = document.getElementById('chat-file-input') as HTMLInputElement;
const chatAttachmentsPreview = document.getElementById('chat-attachments')!;

// Orchestration attachment elements
const btnAttachOrchestration = document.getElementById('btn-attach-orchestration')!;
const orchestrationFileInput = document.getElementById('orchestration-file-input') as HTMLInputElement;
const orchestrationAttachmentsPreview = document.getElementById('orchestration-attachments')!;

// ============ State ============

let currentTab = 'control';
let isPaired = false;
let personas: Persona[] = [];
let selectedPersonaId: string | null = null;
let rooms: OrchestrationRoom[] = [];
let selectedRoomId: string | null = null;
let chatHistory: ChatMessage[] = [];
let orchestrationHistory: OrchestrationMessage[] = [];
let streamingMessages: Map<string, string> = new Map(); // personaId -> accumulated content

// Pending file attachments
let chatPendingAttachments: ChatAttachment[] = [];
let orchestrationPendingAttachments: ChatAttachment[] = [];
let isUploadingChat = false;
let isUploadingOrchestration = false;

// ============ Local Storage Helpers ============

async function saveChatHistory(personaId: string, messages: ChatMessage[]): Promise<void> {
  const key = `chat_history_${personaId}`;
  await chrome.storage.local.set({ [key]: messages.slice(-100) }); // Keep last 100 messages
}

async function loadLocalChatHistory(personaId: string): Promise<ChatMessage[]> {
  const key = `chat_history_${personaId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

async function clearLocalChatHistory(personaId: string): Promise<void> {
  const key = `chat_history_${personaId}`;
  await chrome.storage.local.remove(key);
}

async function saveOrchestrationHistory(roomId: string, messages: OrchestrationMessage[]): Promise<void> {
  const key = `orch_history_${roomId}`;
  await chrome.storage.local.set({ [key]: messages.slice(-100) }); // Keep last 100 messages
}

async function loadLocalOrchestrationHistory(roomId: string): Promise<OrchestrationMessage[]> {
  const key = `orch_history_${roomId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

// ============ State Management ============

function showState(state: 'loading' | 'unpaired' | 'connected' | 'disconnected' | 'error') {
  // Hide all states first
  stateLoading.classList.add('hidden');
  stateUnpaired.classList.add('hidden');
  stateConnected.classList.add('hidden');
  stateDisconnected.classList.add('hidden');
  stateError.classList.add('hidden');

  // Hide all tabs and nav
  navTabs.classList.add('hidden');
  tabControl.classList.add('hidden');
  tabChat.classList.add('hidden');
  tabOrchestration.classList.add('hidden');

  switch (state) {
    case 'loading':
      stateLoading.classList.remove('hidden');
      break;
    case 'unpaired':
      stateUnpaired.classList.remove('hidden');
      isPaired = false;
      break;
    case 'connected':
      navTabs.classList.remove('hidden');
      tabControl.classList.remove('hidden');
      stateConnected.classList.remove('hidden');
      isPaired = true;
      // Don't auto-switch tabs, just show control with connected state
      if (currentTab !== 'control') {
        showTab(currentTab);
      }
      break;
    case 'disconnected':
      navTabs.classList.remove('hidden');
      tabControl.classList.remove('hidden');
      stateDisconnected.classList.remove('hidden');
      isPaired = true;
      if (currentTab !== 'control') {
        showTab(currentTab);
      }
      break;
    case 'error':
      stateError.classList.remove('hidden');
      break;
  }
}

function showTab(tab: string) {
  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });

  // Show/hide tab content
  tabControl.classList.add('hidden');
  tabChat.classList.add('hidden');
  tabOrchestration.classList.add('hidden');

  if (tab === 'control') {
    tabControl.classList.remove('hidden');
  } else if (tab === 'chat') {
    tabChat.classList.remove('hidden');
    if (isPaired) {
      loadPersonas();
    }
  } else if (tab === 'orchestration') {
    tabOrchestration.classList.remove('hidden');
    if (isPaired) {
      loadRooms();
    }
  }
}

function showError(message: string) {
  errorText.textContent = message;
  showState('error');
}

async function sendMessage(message: PopupMessage): Promise<unknown> {
  return new Promise((resolve) => {
    // Add timeout to prevent indefinite waiting
    const timeout = setTimeout(() => {
      console.warn('[Popup] Message timeout for:', message.type);
      resolve(undefined);
    }, 5000);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        console.error('[Popup] Message error:', chrome.runtime.lastError);
        resolve(undefined);
      } else {
        resolve(response);
      }
    });
  });
}

// ============ Initial Load ============

async function loadStatus() {
  showState('loading');

  try {
    const status = (await sendMessage({ type: 'GET_STATUS' })) as ConnectionStatus | undefined;

    // Handle undefined response (service worker not ready)
    if (!status) {
      console.error('[Popup] No response from service worker');
      showState('unpaired');
      return;
    }

    if (!status.paired) {
      showState('unpaired');
      return;
    }

    if (status.connected) {
      personaName.textContent = status.personaName || 'All Personas';
      showState('connected');
      loadActivities();
      initChatWebSocket();
    } else {
      personaNameDisconnected.textContent = status.personaName || 'All Personas';
      showState('disconnected');
    }
  } catch (error) {
    console.error('[Popup] Failed to load status:', error);
    showError('Failed to load status');
  }
}

// ============ Pairing ============

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

async function handleDisconnect() {
  try {
    disconnectChatWebSocket();
    await sendMessage({ type: 'DISCONNECT' });
    inputPairingCode.value = '';
    showState('unpaired');
  } catch (error) {
    showError('Failed to disconnect');
  }
}

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

async function handleTest() {
  btnTest.textContent = 'Testing...';
  btnTest.setAttribute('disabled', 'true');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError('No active tab');
      return;
    }

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
    btnTest.textContent = 'N/A on this page';
    setTimeout(() => {
      btnTest.textContent = 'Test Connection';
    }, 2000);
  } finally {
    btnTest.removeAttribute('disabled');
  }
}

// ============ Activities ============

async function loadActivities() {
  try {
    const response = (await sendMessage({ type: 'GET_ACTIVITIES' })) as {
      activities: Array<{
        id: string;
        timestamp: number;
        action: string;
        status: 'pending' | 'success' | 'error';
        details?: string;
        error?: string;
      }>;
    };

    if (response.activities && response.activities.length > 0) {
      activityLog.classList.remove('hidden');
      activityList.innerHTML = '';

      for (const activity of response.activities.slice(0, 10)) {
        const li = document.createElement('li');
        li.className = `activity-item activity-${activity.status}`;

        const time = new Date(activity.timestamp).toLocaleTimeString();
        const statusIcon = activity.status === 'success' ? '✓' : activity.status === 'error' ? '✗' : '⋯';
        const statusClass = activity.status === 'success' ? 'success' : activity.status === 'error' ? 'error' : 'pending';

        li.innerHTML = `
          <span class="activity-time">${time}</span>
          <span class="activity-action">${activity.action}</span>
          <span class="activity-status ${statusClass}">${statusIcon}</span>
          ${activity.error ? `<span class="activity-error">${activity.error}</span>` : ''}
        `;

        activityList.appendChild(li);
      }
    } else {
      activityLog.classList.add('hidden');
    }
  } catch (error) {
    console.error('Failed to load activities:', error);
  }
}

// ============ Chat WebSocket ============

function showReconnectingIndicator() {
  // Add indicator to chat messages area
  if (currentTab === 'chat' && !document.getElementById('reconnecting-chat')) {
    const indicator = document.createElement('div');
    indicator.id = 'reconnecting-chat';
    indicator.className = 'reconnecting-indicator';
    indicator.textContent = '⟳ Reconnecting...';
    chatMessages.insertBefore(indicator, chatMessages.firstChild);
  }
  // Add indicator to orchestration messages area
  if (currentTab === 'orchestration' && !document.getElementById('reconnecting-orch')) {
    const indicator = document.createElement('div');
    indicator.id = 'reconnecting-orch';
    indicator.className = 'reconnecting-indicator';
    indicator.textContent = '⟳ Reconnecting...';
    orchestrationMessages.insertBefore(indicator, orchestrationMessages.firstChild);
  }
}

function removeReconnectingIndicator() {
  document.getElementById('reconnecting-chat')?.remove();
  document.getElementById('reconnecting-orch')?.remove();
}

function initChatWebSocket() {
  connectChatWebSocket({
    onConnect: () => {
      console.log('[Popup] Chat WebSocket connected');
      // Remove any reconnecting indicator
      removeReconnectingIndicator();
    },
    onDisconnect: () => {
      console.log('[Popup] Chat WebSocket disconnected');
      // Show reconnecting indicator if auto-reconnect is happening
      if (isChatWebSocketReconnecting()) {
        showReconnectingIndicator();
      }
    },
    onStart: (data) => {
      console.log('[Popup] Stream started:', data);
      streamingMessages.clear();
    },
    onChunk: (data) => {
      const key = data.personaId || 'default';
      const current = streamingMessages.get(key) || '';
      streamingMessages.set(key, current + data.content);

      // Update UI with streaming content
      if (currentTab === 'chat') {
        updateChatStreamingMessage(current + data.content);
      } else if (currentTab === 'orchestration') {
        updateOrchestrationStreamingMessage(
          data.personaId || '',
          data.personaName || 'Agent',
          current + data.content
        );
      }
    },
    onComplete: (data) => {
      console.log('[Popup] Stream complete:', data);
      if (currentTab === 'chat') {
        finalizeChatMessage(data.fullResponse);
      } else if (currentTab === 'orchestration') {
        finalizeOrchestrationMessage(
          data.personaId || '',
          data.personaName || 'Agent',
          data.fullResponse
        );
      }
    },
    onDone: () => {
      console.log('[Popup] All responses complete');
      streamingMessages.clear();
      enableInput();
    },
    onError: (error) => {
      console.error('[Popup] WebSocket error:', error);
      enableInput();
    },
  });
}

function enableInput() {
  chatInput.disabled = false;
  orchestrationInput.disabled = false;
  updateChatSendButton();
  updateOrchestrationSendButton();
}

// ============ Chat (Single Persona) ============

async function loadPersonas() {
  try {
    personas = await listPersonas();
    updatePersonaSelect();
  } catch (error) {
    console.error('Failed to load personas:', error);
  }
}

function updatePersonaSelect() {
  personaSelect.innerHTML = '<option value="">Select persona...</option>';
  for (const persona of personas) {
    const option = document.createElement('option');
    option.value = persona.id;
    option.textContent = persona.name;
    personaSelect.appendChild(option);
  }
}

async function loadChatHistory() {
  if (!selectedPersonaId) return;

  try {
    // Load from local storage
    chatHistory = await loadLocalChatHistory(selectedPersonaId);
    renderChatMessages();
  } catch (error) {
    console.error('Failed to load chat history:', error);
    chatHistory = [];
    renderChatMessages();
  }
}

function renderChatMessages() {
  if (chatHistory.length === 0) {
    chatMessages.innerHTML = `
      <div class="chat-empty">
        <p>Start a conversation with ${personaSelect.options[personaSelect.selectedIndex]?.text || 'this persona'}</p>
      </div>
    `;
    return;
  }

  chatMessages.innerHTML = '';
  for (const msg of chatHistory) {
    appendChatMessage(msg.role, msg.content, false);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatMessage(role: 'user' | 'assistant', content: string, streaming = false) {
  // Remove empty state if present
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  // Remove existing streaming message if finalizing
  if (!streaming) {
    const existing = chatMessages.querySelector('.message.streaming');
    if (existing) existing.remove();
  }

  const div = document.createElement('div');
  div.className = `message ${role}${streaming ? ' streaming' : ''}`;
  div.id = streaming ? 'streaming-message' : '';

  const senderName = role === 'user' ? 'You' : personaSelect.options[personaSelect.selectedIndex]?.text || 'Agent';
  const avatarContent = role === 'user' ? 'U' : senderName.charAt(0).toUpperCase();

  div.innerHTML = `
    <div class="message-avatar">${avatarContent}</div>
    <div class="message-wrapper">
      <div class="message-sender">${senderName}</div>
      <div class="message-content">${escapeHtml(content)}</div>
    </div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateChatStreamingMessage(content: string) {
  let streamingDiv = document.getElementById('streaming-message');
  if (!streamingDiv) {
    appendChatMessage('assistant', content, true);
  } else {
    const contentDiv = streamingDiv.querySelector('.message-wrapper .message-content');
    if (contentDiv) {
      contentDiv.textContent = content;
    }
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function finalizeChatMessage(content: string) {
  const streamingDiv = document.getElementById('streaming-message');
  if (streamingDiv) {
    streamingDiv.classList.remove('streaming');
    streamingDiv.removeAttribute('id');
    const contentDiv = streamingDiv.querySelector('.message-wrapper .message-content');
    if (contentDiv) {
      contentDiv.textContent = content;
    }
  } else {
    appendChatMessage('assistant', content, false);
  }
  chatHistory.push({ role: 'assistant', content });

  // Save to local storage
  if (selectedPersonaId) {
    await saveChatHistory(selectedPersonaId, chatHistory);
  }
}

async function handleSendChat() {
  const message = chatInput.value.trim();
  const hasAttachments = chatPendingAttachments.length > 0;

  if ((!message && !hasAttachments) || !selectedPersonaId) return;

  // Disable input while sending
  chatInput.disabled = true;
  btnSendChat.disabled = true;
  chatInput.value = '';

  // Capture attachments and clear them
  const attachments = hasAttachments ? [...chatPendingAttachments] : undefined;
  clearChatAttachments();

  // Build display message (include attachment info)
  let displayMessage = message;
  if (attachments && attachments.length > 0) {
    const fileNames = attachments.map(a => a.filename).join(', ');
    displayMessage = message ? `${message}\n📎 ${fileNames}` : `📎 ${fileNames}`;
  }

  // Add user message to UI and history
  appendChatMessage('user', displayMessage);
  chatHistory.push({ role: 'user', content: displayMessage });

  // Save user message to local storage
  await saveChatHistory(selectedPersonaId, chatHistory);

  // Send via WebSocket
  if (isChatWebSocketConnected()) {
    sendChatMessageWS(selectedPersonaId, message || 'Please analyze the attached file(s).', attachments);
  } else {
    // Fallback: reconnect and try again
    initChatWebSocket();
    setTimeout(() => {
      if (isChatWebSocketConnected()) {
        sendChatMessageWS(selectedPersonaId!, message || 'Please analyze the attached file(s).', attachments);
      } else {
        appendChatMessage('assistant', 'Failed to connect. Please try again.');
        enableInput();
      }
    }, 1000);
  }
}

async function handleClearChat() {
  if (!selectedPersonaId) return;

  try {
    // Clear local storage
    await clearLocalChatHistory(selectedPersonaId);
    // Also clear on server
    await clearChatSession(selectedPersonaId);
    chatHistory = [];
    renderChatMessages();
  } catch (error) {
    console.error('Failed to clear chat:', error);
  }
}

// ============ Orchestration (Multi-Persona) ============

async function loadRooms() {
  try {
    rooms = await listOrchestrationRooms();
    updateRoomSelect();
  } catch (error) {
    console.error('Failed to load rooms:', error);
  }
}

function updateRoomSelect() {
  roomSelect.innerHTML = `
    <option value="">Select room...</option>
    <option value="__new__">+ New Room</option>
  `;
  for (const room of rooms) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.name || `Room ${room.id.slice(0, 6)}`;
    roomSelect.appendChild(option);
  }
}

async function loadOrchestrationHistory() {
  if (!selectedRoomId) return;

  try {
    // First try to load from local storage
    orchestrationHistory = await loadLocalOrchestrationHistory(selectedRoomId);

    // If empty, try to load from server
    if (orchestrationHistory.length === 0) {
      const data = await getOrchestrationRoom(selectedRoomId);
      orchestrationHistory = data.messages;
      // Save to local storage
      if (orchestrationHistory.length > 0) {
        await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);
      }
    }

    renderOrchestrationMessages();
  } catch (error) {
    console.error('Failed to load room:', error);
    orchestrationHistory = [];
    renderOrchestrationMessages();
  }
}

function renderOrchestrationMessages() {
  if (orchestrationHistory.length === 0) {
    orchestrationMessages.innerHTML = `
      <div class="chat-empty">
        <p>Start a conversation with all your personas</p>
        <p class="help-hint">Use @name to mention specific personas</p>
      </div>
    `;
    return;
  }

  orchestrationMessages.innerHTML = '';
  for (const msg of orchestrationHistory) {
    appendOrchestrationMessage(msg.role, msg.personaName || 'User', msg.content, false);
  }
  orchestrationMessages.scrollTop = orchestrationMessages.scrollHeight;
}

function appendOrchestrationMessage(
  role: 'user' | 'assistant',
  senderName: string,
  content: string,
  streaming = false,
  personaId?: string
) {
  // Remove empty state if present
  const empty = orchestrationMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}${streaming ? ' streaming' : ''}`;
  if (streaming && personaId) {
    div.id = `streaming-${personaId}`;
  }

  const displayName = role === 'user' ? 'You' : senderName;
  const avatarContent = role === 'user' ? 'U' : senderName.charAt(0).toUpperCase();

  div.innerHTML = `
    <div class="message-avatar">${avatarContent}</div>
    <div class="message-wrapper">
      <div class="message-sender">${displayName}</div>
      <div class="message-content">${escapeHtml(content)}</div>
    </div>
  `;

  orchestrationMessages.appendChild(div);
  orchestrationMessages.scrollTop = orchestrationMessages.scrollHeight;
}

function updateOrchestrationStreamingMessage(personaId: string, personaName: string, content: string) {
  let streamingDiv = document.getElementById(`streaming-${personaId}`);
  if (!streamingDiv) {
    appendOrchestrationMessage('assistant', personaName, content, true, personaId);
  } else {
    const contentDiv = streamingDiv.querySelector('.message-wrapper .message-content');
    if (contentDiv) {
      contentDiv.textContent = content;
    }
  }
  orchestrationMessages.scrollTop = orchestrationMessages.scrollHeight;
}

async function finalizeOrchestrationMessage(personaId: string, personaName: string, content: string) {
  const streamingDiv = document.getElementById(`streaming-${personaId}`);
  if (streamingDiv) {
    streamingDiv.classList.remove('streaming');
    streamingDiv.removeAttribute('id');
    const contentDiv = streamingDiv.querySelector('.message-wrapper .message-content');
    if (contentDiv) {
      contentDiv.textContent = content;
    }
  } else {
    appendOrchestrationMessage('assistant', personaName, content, false);
  }
  orchestrationHistory.push({
    id: '',
    role: 'assistant',
    personaId,
    personaName,
    content,
    createdAt: new Date().toISOString(),
  });

  // Save to local storage
  if (selectedRoomId) {
    await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);
  }
}

async function handleSendOrchestration() {
  const message = orchestrationInput.value.trim();
  const hasAttachments = orchestrationPendingAttachments.length > 0;

  if ((!message && !hasAttachments) || !selectedRoomId) return;

  // Disable input while sending
  orchestrationInput.disabled = true;
  btnSendOrchestration.disabled = true;
  orchestrationInput.value = '';

  // Capture attachments and clear them
  const attachments = hasAttachments ? [...orchestrationPendingAttachments] : undefined;
  clearOrchestrationAttachments();

  // Build display message (include attachment info)
  let displayMessage = message;
  if (attachments && attachments.length > 0) {
    const fileNames = attachments.map(a => a.filename).join(', ');
    displayMessage = message ? `${message}\n📎 ${fileNames}` : `📎 ${fileNames}`;
  }

  // Add user message to UI and history
  appendOrchestrationMessage('user', 'You', displayMessage);
  orchestrationHistory.push({
    id: '',
    role: 'user',
    personaId: null,
    personaName: null,
    content: displayMessage,
    createdAt: new Date().toISOString(),
  });

  // Save to local storage
  await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);

  // Send via WebSocket
  if (isChatWebSocketConnected()) {
    sendOrchestrationMessageWS(selectedRoomId, message || 'Please analyze the attached file(s).', attachments);
  } else {
    initChatWebSocket();
    setTimeout(() => {
      if (isChatWebSocketConnected()) {
        sendOrchestrationMessageWS(selectedRoomId!, message || 'Please analyze the attached file(s).', attachments);
      } else {
        appendOrchestrationMessage('assistant', 'System', 'Failed to connect. Please try again.', false);
        enableInput();
      }
    }, 1000);
  }
}

async function handleCreateRoom() {
  try {
    const room = await createOrchestrationRoom();
    rooms.unshift(room);
    updateRoomSelect();
    roomSelect.value = room.id;
    selectedRoomId = room.id;
    orchestrationHistory = [];
    renderOrchestrationMessages();
    btnSendOrchestration.disabled = !orchestrationInput.value.trim();
  } catch (error) {
    console.error('Failed to create room:', error);
  }
}

async function handleDeleteRoom() {
  if (!selectedRoomId) return;

  try {
    await deleteOrchestrationRoom(selectedRoomId);
    rooms = rooms.filter((r) => r.id !== selectedRoomId);
    selectedRoomId = null;
    updateRoomSelect();
    orchestrationHistory = [];
    renderOrchestrationMessages();
    roomMenu.classList.add('hidden');
  } catch (error) {
    console.error('Failed to delete room:', error);
  }
}

async function handleClearRoomMessages() {
  if (!selectedRoomId) return;

  try {
    // Clear local storage
    const key = `orch_history_${selectedRoomId}`;
    await chrome.storage.local.remove(key);
    // Also clear on server
    await clearOrchestrationRoomMessages(selectedRoomId);
    orchestrationHistory = [];
    renderOrchestrationMessages();
    roomMenu.classList.add('hidden');
  } catch (error) {
    console.error('Failed to clear messages:', error);
  }
}

// ============ Utility Functions ============

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function autoResizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

// ============ Attachment Handling ============

function renderAttachmentPreview(
  container: HTMLElement,
  attachments: ChatAttachment[],
  onRemove: (index: number) => void
) {
  if (attachments.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = '';

  attachments.forEach((attachment, index) => {
    const item = document.createElement('div');
    item.className = 'attachment-item';

    const isImage = attachment.mimeType.startsWith('image/');
    const icon = isImage ? '🖼️' : '📄';

    item.innerHTML = `
      <span class="attachment-icon">${icon}</span>
      <span class="attachment-name" title="${escapeHtml(attachment.filename)}">${escapeHtml(truncateFilename(attachment.filename, 20))}</span>
      <button class="attachment-remove" data-index="${index}" title="Remove">×</button>
    `;

    const removeBtn = item.querySelector('.attachment-remove');
    removeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRemove(index);
    });

    container.appendChild(item);
  });
}

function truncateFilename(filename: string, maxLength: number): string {
  if (filename.length <= maxLength) return filename;
  const ext = filename.lastIndexOf('.');
  if (ext > 0 && filename.length - ext <= 5) {
    const name = filename.slice(0, ext);
    const extension = filename.slice(ext);
    return name.slice(0, maxLength - extension.length - 3) + '...' + extension;
  }
  return filename.slice(0, maxLength - 3) + '...';
}

async function handleChatFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  isUploadingChat = true;
  btnAttachChat.classList.add('uploading');

  try {
    for (const file of Array.from(files)) {
      const attachment = await prepareFileAttachment(file);
      chatPendingAttachments.push(attachment);
    }
    renderAttachmentPreview(chatAttachmentsPreview, chatPendingAttachments, removeChatAttachment);
    updateChatSendButton();
  } catch (error) {
    console.error('Failed to prepare attachment:', error);
    alert('Failed to upload file. Please try again.');
  } finally {
    isUploadingChat = false;
    btnAttachChat.classList.remove('uploading');
    input.value = ''; // Reset input
  }
}

async function handleOrchestrationFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  isUploadingOrchestration = true;
  btnAttachOrchestration.classList.add('uploading');

  try {
    for (const file of Array.from(files)) {
      const attachment = await prepareFileAttachment(file);
      orchestrationPendingAttachments.push(attachment);
    }
    renderAttachmentPreview(orchestrationAttachmentsPreview, orchestrationPendingAttachments, removeOrchestrationAttachment);
    updateOrchestrationSendButton();
  } catch (error) {
    console.error('Failed to prepare attachment:', error);
    alert('Failed to upload file. Please try again.');
  } finally {
    isUploadingOrchestration = false;
    btnAttachOrchestration.classList.remove('uploading');
    input.value = ''; // Reset input
  }
}

function removeChatAttachment(index: number) {
  chatPendingAttachments.splice(index, 1);
  renderAttachmentPreview(chatAttachmentsPreview, chatPendingAttachments, removeChatAttachment);
  updateChatSendButton();
}

function removeOrchestrationAttachment(index: number) {
  orchestrationPendingAttachments.splice(index, 1);
  renderAttachmentPreview(orchestrationAttachmentsPreview, orchestrationPendingAttachments, removeOrchestrationAttachment);
  updateOrchestrationSendButton();
}

function updateChatSendButton() {
  const hasContent = chatInput.value.trim().length > 0 || chatPendingAttachments.length > 0;
  btnSendChat.disabled = !hasContent || !selectedPersonaId;
}

function updateOrchestrationSendButton() {
  const hasContent = orchestrationInput.value.trim().length > 0 || orchestrationPendingAttachments.length > 0;
  btnSendOrchestration.disabled = !hasContent || !selectedRoomId;
}

function clearChatAttachments() {
  chatPendingAttachments = [];
  renderAttachmentPreview(chatAttachmentsPreview, chatPendingAttachments, removeChatAttachment);
}

function clearOrchestrationAttachments() {
  orchestrationPendingAttachments = [];
  renderAttachmentPreview(orchestrationAttachmentsPreview, orchestrationPendingAttachments, removeOrchestrationAttachment);
}

// ============ Event Listeners ============

// Navigation
navTabs.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const tab = target.getAttribute('data-tab');
  if (tab) {
    showTab(tab);
  }
});

// Pairing
btnPair.addEventListener('click', handlePair);
btnDisconnect.addEventListener('click', handleDisconnect);
btnDisconnect2.addEventListener('click', handleDisconnect);
btnReconnect.addEventListener('click', handleReconnect);
btnTest.addEventListener('click', handleTest);
btnRetry.addEventListener('click', loadStatus);

inputPairingCode.addEventListener('input', () => {
  inputPairingCode.value = inputPairingCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

inputPairingCode.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handlePair();
  }
});

// Chat
personaSelect.addEventListener('change', () => {
  selectedPersonaId = personaSelect.value || null;
  if (selectedPersonaId) {
    loadChatHistory();
  } else {
    chatHistory = [];
    renderChatMessages();
  }
  // Clear attachments when switching personas
  clearChatAttachments();
  updateChatSendButton();
});

chatInput.addEventListener('input', () => {
  autoResizeTextarea(chatInput);
  updateChatSendButton();
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendChat();
  }
});

btnSendChat.addEventListener('click', handleSendChat);
btnClearChat.addEventListener('click', handleClearChat);

// Chat attachments
btnAttachChat.addEventListener('click', () => {
  if (!isUploadingChat) {
    chatFileInput.click();
  }
});
chatFileInput.addEventListener('change', handleChatFileSelect);

// Orchestration
roomSelect.addEventListener('change', async () => {
  const value = roomSelect.value;
  if (value === '__new__') {
    await handleCreateRoom();
  } else {
    selectedRoomId = value || null;
    if (selectedRoomId) {
      loadOrchestrationHistory();
    } else {
      orchestrationHistory = [];
      renderOrchestrationMessages();
    }
  }
  // Clear attachments when switching rooms
  clearOrchestrationAttachments();
  updateOrchestrationSendButton();
});

orchestrationInput.addEventListener('input', () => {
  autoResizeTextarea(orchestrationInput);
  updateOrchestrationSendButton();
});

orchestrationInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendOrchestration();
  }
});

btnSendOrchestration.addEventListener('click', handleSendOrchestration);

// Orchestration attachments
btnAttachOrchestration.addEventListener('click', () => {
  if (!isUploadingOrchestration) {
    orchestrationFileInput.click();
  }
});
orchestrationFileInput.addEventListener('change', handleOrchestrationFileSelect);

btnRoomMenu.addEventListener('click', () => {
  roomMenu.classList.toggle('hidden');
});

btnClearRoom.addEventListener('click', handleClearRoomMessages);
btnDeleteRoom.addEventListener('click', handleDeleteRoom);

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!btnRoomMenu.contains(e.target as Node) && !roomMenu.contains(e.target as Node)) {
    roomMenu.classList.add('hidden');
  }
});

// ============ Initialize ============

loadStatus();

// Refresh activities every 2 seconds when popup is open
setInterval(() => {
  if (!stateConnected.classList.contains('hidden')) {
    loadActivities();
  }
}, 2000);
