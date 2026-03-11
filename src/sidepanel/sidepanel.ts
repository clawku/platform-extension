/**
 * Clawku Side Panel
 * Always-visible chat interface alongside the browser
 * Matches popup design system exactly
 */

import type { ConnectionStatus, PopupMessage } from '../types/messages.js';
import {
  listPersonas,
  listOrchestrationRooms,
  getOrchestrationRoom,
  createOrchestrationRoom,
  clearOrchestrationRoomMessages,
  connectChatWebSocket,
  disconnectChatWebSocket,
  isChatWebSocketConnected,
  sendChatMessageWS,
  sendOrchestrationMessageWS,
  prepareFileAttachment,
  type Persona,
  type ChatMessage,
  type OrchestrationRoom,
  type OrchestrationMessage,
  type ChatAttachment,
} from '../popup/api.js';

// ============ Element References ============

// States
const stateLoading = document.getElementById('state-loading')!;
const stateUnpaired = document.getElementById('state-unpaired')!;
const stateError = document.getElementById('state-error')!;
const navTabs = document.getElementById('nav-tabs')!;
const tabChat = document.getElementById('tab-chat')!;
const tabTeam = document.getElementById('tab-team')!;
const tabLearning = document.getElementById('tab-learning')!;
const tabSettings = document.getElementById('tab-settings')!;

// Consent overlay elements
const consentOverlay = document.getElementById('consent-overlay')!;
const consentDescription = document.getElementById('consent-description')!;
const consentDomain = document.getElementById('consent-domain')!;
const consentAction = document.getElementById('consent-action')!;
const btnConsentDeny = document.getElementById('btn-consent-deny')!;
const btnConsentAllow = document.getElementById('btn-consent-allow')!;
const consentRememberCheckbox = document.getElementById('consent-remember-checkbox') as HTMLInputElement;

// Feedback toast elements
const feedbackToast = document.getElementById('feedback-toast')!;
const feedbackDescription = document.getElementById('feedback-description')!;
const feedbackProgressBar = document.getElementById('feedback-progress-bar')!;
const btnFeedbackGood = document.getElementById('btn-feedback-good')!;
const btnFeedbackBad = document.getElementById('btn-feedback-bad')!;

// Learning tab elements
const learningEnabled = document.getElementById('learning-enabled') as HTMLInputElement;
const statPatterns = document.getElementById('stat-patterns')!;
const statActions = document.getElementById('stat-actions')!;
const statHitRate = document.getElementById('stat-hit-rate')!;
const statSuccessRate = document.getElementById('stat-success-rate')!;
const topDomains = document.getElementById('top-domains')!;
const btnClearPatterns = document.getElementById('btn-clear-patterns')!;
const btnExportPatterns = document.getElementById('btn-export-patterns')!;

// Pairing
const pairingCode = document.getElementById('pairing-code') as HTMLInputElement;
const apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
const btnPair = document.getElementById('btn-pair')!;

// Chat
const personaSelect = document.getElementById('persona-select') as HTMLSelectElement;
const btnClearChat = document.getElementById('btn-clear-chat')!;
const chatMessages = document.getElementById('chat-messages')!;
const chatAttachments = document.getElementById('chat-attachments')!;
const btnAttachChat = document.getElementById('btn-attach-chat')!;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const btnSendChat = document.getElementById('btn-send-chat')!;
const chatFileInput = document.getElementById('chat-file-input') as HTMLInputElement;

// Team
const roomSelect = document.getElementById('room-select') as HTMLSelectElement;
const btnRoomMenu = document.getElementById('btn-room-menu')!;
const roomMenu = document.getElementById('room-menu')!;
const btnClearRoom = document.getElementById('btn-clear-room')!;
const btnDeleteRoom = document.getElementById('btn-delete-room')!;
const teamMessages = document.getElementById('team-messages')!;
const teamAttachments = document.getElementById('team-attachments')!;
const btnAttachTeam = document.getElementById('btn-attach-team')!;
const teamInput = document.getElementById('team-input') as HTMLTextAreaElement;
const btnSendTeam = document.getElementById('btn-send-team')!;
const teamFileInput = document.getElementById('team-file-input') as HTMLInputElement;

// Settings
const userEmail = document.getElementById('user-email')!;
const extensionIdEl = document.getElementById('extension-id')!;
const apiUrlDisplay = document.getElementById('api-url-display')!;
const btnDisconnect = document.getElementById('btn-disconnect')!;

// Error
const errorText = document.getElementById('error-text')!;
const btnRetry = document.getElementById('btn-retry')!;

// ============ State ============

let currentTab: 'chat' | 'team' | 'learning' | 'settings' = 'chat';
let isPaired = false;
let personas: Persona[] = [];
let selectedPersonaId: string | null = null;
let rooms: OrchestrationRoom[] = [];
let selectedRoomId: string | null = null;
let chatHistory: ChatMessage[] = [];
let orchestrationHistory: OrchestrationMessage[] = [];
let streamingMessages = new Map<string, string>();
let chatPendingAttachments: ChatAttachment[] = [];
let teamPendingAttachments: ChatAttachment[] = [];
let isUploadingChat = false;
let isUploadingTeam = false;

// ============ State Management ============

function setState(state: 'loading' | 'unpaired' | 'connected' | 'error') {
  // Hide all states
  stateLoading.classList.add('hidden');
  stateUnpaired.classList.add('hidden');
  stateError.classList.add('hidden');
  navTabs.classList.add('hidden');
  tabChat.classList.add('hidden');
  tabTeam.classList.add('hidden');
  tabLearning.classList.add('hidden');
  tabSettings.classList.add('hidden');

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
      isPaired = true;
      showTab(currentTab);
      break;
    case 'error':
      stateError.classList.remove('hidden');
      break;
  }
}

function showTab(tab: 'chat' | 'team' | 'learning' | 'settings') {
  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });

  // Show/hide tab content
  tabChat.classList.add('hidden');
  tabTeam.classList.add('hidden');
  tabLearning.classList.add('hidden');
  tabSettings.classList.add('hidden');

  if (tab === 'chat') {
    tabChat.classList.remove('hidden');
    if (isPaired) loadPersonas();
  } else if (tab === 'team') {
    tabTeam.classList.remove('hidden');
    if (isPaired) loadRooms();
  } else if (tab === 'learning') {
    tabLearning.classList.remove('hidden');
    loadLearningStats();
  } else if (tab === 'settings') {
    tabSettings.classList.remove('hidden');
    loadSettings();
  }
}

function showError(message: string) {
  errorText.textContent = message;
  setState('error');
}

// ============ Storage Helpers ============

async function saveChatHistory(personaId: string, messages: ChatMessage[]): Promise<void> {
  const key = `chat_history_${personaId}`;
  await chrome.storage.local.set({ [key]: messages.slice(-100) });
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
  await chrome.storage.local.set({ [key]: messages.slice(-100) });
}

async function loadLocalOrchestrationHistory(roomId: string): Promise<OrchestrationMessage[]> {
  const key = `orch_history_${roomId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

// ============ Service Worker Communication ============

async function sendMessage(message: PopupMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 5000);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        resolve(undefined);
      } else {
        resolve(response);
      }
    });
  });
}

// ============ Initialization ============

async function loadStatus() {
  setState('loading');

  try {
    const status = (await sendMessage({ type: 'GET_STATUS' })) as ConnectionStatus | undefined;

    if (!status) {
      console.error('[SidePanel] No response from service worker');
      setState('unpaired');
      return;
    }

    if (!status.paired) {
      setState('unpaired');
      return;
    }

    if (status.connected) {
      setState('connected');
      initChatWebSocket();
    } else {
      setState('unpaired');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to load status:', error);
    showError('Failed to load status');
  }
}

// ============ Pairing ============

async function handlePair() {
  const code = pairingCode.value.trim().toUpperCase();
  if (!code || code.length < 6) {
    showError('Please enter a valid 6-digit code');
    return;
  }

  const apiUrl = apiUrlInput.value.trim() || undefined;

  btnPair.textContent = 'Connecting...';
  (btnPair as HTMLButtonElement).disabled = true;

  try {
    const result = (await sendMessage({
      type: 'PAIR',
      payload: { code, apiBaseUrl: apiUrl },
    })) as { success: boolean; error?: string };

    if (result?.success) {
      setState('connected');
      initChatWebSocket();
      loadPersonas();
    } else {
      showError(result?.error || 'Pairing failed');
    }
  } catch (error) {
    showError('Connection error');
  } finally {
    btnPair.textContent = 'Connect';
    (btnPair as HTMLButtonElement).disabled = false;
  }
}

async function handleDisconnect() {
  disconnectChatWebSocket();
  await sendMessage({ type: 'DISCONNECT' });
  pairingCode.value = '';
  setState('unpaired');
}

// ============ Settings ============

async function loadSettings() {
  const status = (await sendMessage({ type: 'GET_STATUS' })) as ConnectionStatus | undefined;
  if (status) {
    userEmail.textContent = status.userEmail || '-';
    extensionIdEl.textContent = status.extensionId?.slice(0, 12) + '...' || '-';
    apiUrlDisplay.textContent = status.apiUrl || 'Default';
  }
}

// ============ Chat WebSocket ============

function initChatWebSocket() {
  connectChatWebSocket({
    onConnect: () => console.log('[SidePanel] Chat WS connected'),
    onDisconnect: () => console.log('[SidePanel] Chat WS disconnected'),
    onStart: () => streamingMessages.clear(),
    onChunk: (data) => {
      const key = data.personaId || 'default';
      const current = streamingMessages.get(key) || '';
      streamingMessages.set(key, current + data.content);

      if (currentTab === 'chat') {
        updateStreamingMessage(chatMessages, current + data.content);
      } else if (currentTab === 'team') {
        updateTeamStreamingMessage(data.personaId || '', data.personaName || 'Agent', current + data.content);
      }
    },
    onComplete: (data) => {
      if (currentTab === 'chat') {
        finalizeChatMessage(data.fullResponse);
      } else if (currentTab === 'team') {
        finalizeTeamMessage(data.personaId || '', data.personaName || 'Agent', data.fullResponse);
      }
    },
    onDone: () => {
      streamingMessages.clear();
      enableInputs();
    },
    onError: (error) => {
      console.error('Chat WS error:', error);
      enableInputs();
    },
  });
}

function enableInputs() {
  chatInput.disabled = false;
  teamInput.disabled = false;
  (btnSendChat as HTMLButtonElement).disabled = !chatInput.value.trim() || !selectedPersonaId;
  (btnSendTeam as HTMLButtonElement).disabled = !teamInput.value.trim() || !selectedRoomId;
}

// ============ Chat (Single Persona) ============

async function loadPersonas() {
  try {
    personas = await listPersonas();
    personaSelect.innerHTML = '<option value="">Select persona...</option>';
    for (const p of personas) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      personaSelect.appendChild(option);
    }
  } catch (error) {
    console.error('Failed to load personas:', error);
  }
}

async function loadChatHistory() {
  if (!selectedPersonaId) return;
  chatHistory = await loadLocalChatHistory(selectedPersonaId);
  renderChatMessages();
}

function renderChatMessages() {
  if (chatHistory.length === 0) {
    chatMessages.innerHTML = '<div class="chat-empty"><p>Select a persona to start chatting</p></div>';
    return;
  }

  chatMessages.innerHTML = '';
  for (const msg of chatHistory) {
    appendMessage(chatMessages, msg.role, msg.content, false);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessage(container: HTMLElement, role: 'user' | 'assistant', content: string, streaming = false, personaName?: string) {
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  if (!streaming) {
    const existing = container.querySelector('.message.streaming');
    if (existing) existing.remove();
  }

  const div = document.createElement('div');
  div.className = `message ${role}${streaming ? ' streaming' : ''}`;
  if (streaming) div.id = 'streaming-message';

  // Get persona name and avatar
  const persona = selectedPersonaId ? personas.find(p => p.id === selectedPersonaId) : null;
  const avatarContent = role === 'user'
    ? 'U'
    : (persona?.name?.charAt(0).toUpperCase() || 'A');
  const senderName = role === 'user' ? 'You' : (personaName || persona?.name || 'Assistant');

  let html = `<div class="message-avatar">${avatarContent}</div>`;
  html += `<div class="message-wrapper">`;
  html += `<div class="message-sender">${escapeHtml(senderName)}</div>`;
  html += `<div class="message-content">${escapeHtml(content)}</div>`;
  html += `</div>`;
  div.innerHTML = html;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function updateStreamingMessage(container: HTMLElement, content: string) {
  let div = container.querySelector('#streaming-message');
  if (!div) {
    appendMessage(container, 'assistant', content, true);
  } else {
    const contentDiv = div.querySelector('.message-wrapper .message-content');
    if (contentDiv) contentDiv.textContent = content;
  }
  container.scrollTop = container.scrollHeight;
}

async function finalizeChatMessage(content: string) {
  const div = chatMessages.querySelector('#streaming-message');
  if (div) {
    div.classList.remove('streaming');
    div.removeAttribute('id');
    const contentDiv = div.querySelector('.message-wrapper .message-content');
    if (contentDiv) contentDiv.textContent = content;
  } else {
    appendMessage(chatMessages, 'assistant', content);
  }
  chatHistory.push({ role: 'assistant', content });
  if (selectedPersonaId) {
    await saveChatHistory(selectedPersonaId, chatHistory);
  }
}

async function handleSendChat() {
  const message = chatInput.value.trim();
  const hasAttachments = chatPendingAttachments.length > 0;

  if ((!message && !hasAttachments) || !selectedPersonaId) return;

  chatInput.disabled = true;
  (btnSendChat as HTMLButtonElement).disabled = true;
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

  appendMessage(chatMessages, 'user', displayMessage);
  chatHistory.push({ role: 'user', content: displayMessage });
  await saveChatHistory(selectedPersonaId, chatHistory);

  if (isChatWebSocketConnected()) {
    sendChatMessageWS(selectedPersonaId, message, attachments);
  } else {
    initChatWebSocket();
    setTimeout(() => {
      if (isChatWebSocketConnected()) {
        sendChatMessageWS(selectedPersonaId!, message, attachments);
      } else {
        appendMessage(chatMessages, 'assistant', 'Failed to connect. Please try again.');
        enableInputs();
      }
    }, 1000);
  }
}

async function handleClearChatHistory() {
  if (!selectedPersonaId) return;
  await clearLocalChatHistory(selectedPersonaId);
  chatHistory = [];
  renderChatMessages();
}

// ============ Team (Orchestration) ============

async function loadRooms() {
  try {
    rooms = await listOrchestrationRooms();
    roomSelect.innerHTML = '<option value="">Select room...</option><option value="__new__">+ New Room</option>';
    for (const r of rooms) {
      const option = document.createElement('option');
      option.value = r.id;
      option.textContent = r.name || `Room ${r.id.slice(0, 6)}`;
      roomSelect.appendChild(option);
    }
  } catch (error) {
    console.error('Failed to load rooms:', error);
  }
}

async function loadOrchestrationHistory() {
  if (!selectedRoomId) return;

  orchestrationHistory = await loadLocalOrchestrationHistory(selectedRoomId);
  if (orchestrationHistory.length === 0) {
    try {
      const data = await getOrchestrationRoom(selectedRoomId);
      orchestrationHistory = data.messages;
      if (orchestrationHistory.length > 0) {
        await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);
      }
    } catch (error) {
      console.error('Failed to load room:', error);
    }
  }
  renderTeamMessages();
}

function renderTeamMessages() {
  if (orchestrationHistory.length === 0) {
    teamMessages.innerHTML = '<div class="chat-empty"><p>Select or create a room to chat with all your personas</p><p class="help-hint">Use @name to mention specific personas</p></div>';
    return;
  }

  teamMessages.innerHTML = '';
  for (const msg of orchestrationHistory) {
    appendTeamMessage(msg.role, msg.personaName || 'User', msg.content, false, msg.personaId || undefined);
  }
  teamMessages.scrollTop = teamMessages.scrollHeight;
}

function appendTeamMessage(role: 'user' | 'assistant', name: string, content: string, streaming = false, personaId?: string) {
  const empty = teamMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}${streaming ? ' streaming' : ''}`;
  if (streaming && personaId) div.id = `streaming-${personaId}`;

  // Get avatar initial
  const avatarContent = role === 'user' ? 'U' : name.charAt(0).toUpperCase();

  let html = `<div class="message-avatar">${avatarContent}</div>`;
  html += `<div class="message-wrapper">`;
  html += `<div class="message-sender">${escapeHtml(name)}</div>`;
  html += `<div class="message-content">${escapeHtml(content)}</div>`;
  html += `</div>`;
  div.innerHTML = html;

  teamMessages.appendChild(div);
  teamMessages.scrollTop = teamMessages.scrollHeight;
}

function updateTeamStreamingMessage(personaId: string, name: string, content: string) {
  let div = teamMessages.querySelector(`#streaming-${personaId}`);
  if (!div) {
    appendTeamMessage('assistant', name, content, true, personaId);
  } else {
    const contentDiv = div.querySelector('.message-wrapper .message-content');
    if (contentDiv) contentDiv.textContent = content;
  }
  teamMessages.scrollTop = teamMessages.scrollHeight;
}

async function finalizeTeamMessage(personaId: string, name: string, content: string) {
  const div = teamMessages.querySelector(`#streaming-${personaId}`);
  if (div) {
    div.classList.remove('streaming');
    div.removeAttribute('id');
    const contentDiv = div.querySelector('.message-wrapper .message-content');
    if (contentDiv) contentDiv.textContent = content;
  } else {
    appendTeamMessage('assistant', name, content);
  }

  orchestrationHistory.push({
    id: '',
    role: 'assistant',
    personaId,
    personaName: name,
    content,
    createdAt: new Date().toISOString(),
  });

  if (selectedRoomId) {
    await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);
  }
}

async function handleSendTeam() {
  const message = teamInput.value.trim();
  const hasAttachments = teamPendingAttachments.length > 0;

  if ((!message && !hasAttachments) || !selectedRoomId) return;

  teamInput.disabled = true;
  (btnSendTeam as HTMLButtonElement).disabled = true;
  teamInput.value = '';

  // Capture attachments and clear them
  const attachments = hasAttachments ? [...teamPendingAttachments] : undefined;
  clearTeamAttachments();

  // Build display message (include attachment info)
  let displayMessage = message;
  if (attachments && attachments.length > 0) {
    const fileNames = attachments.map(a => a.filename).join(', ');
    displayMessage = message ? `${message}\n📎 ${fileNames}` : `📎 ${fileNames}`;
  }

  appendTeamMessage('user', 'You', displayMessage);
  orchestrationHistory.push({
    id: '',
    role: 'user',
    personaId: null,
    personaName: null,
    content: displayMessage,
    createdAt: new Date().toISOString(),
  });
  await saveOrchestrationHistory(selectedRoomId, orchestrationHistory);

  if (isChatWebSocketConnected()) {
    sendOrchestrationMessageWS(selectedRoomId, message, attachments);
  } else {
    initChatWebSocket();
    setTimeout(() => {
      if (isChatWebSocketConnected()) {
        sendOrchestrationMessageWS(selectedRoomId!, message, attachments);
      } else {
        appendTeamMessage('assistant', 'System', 'Failed to connect. Please try again.');
        enableInputs();
      }
    }, 1000);
  }
}

async function handleCreateRoom() {
  try {
    const room = await createOrchestrationRoom();
    rooms.unshift(room);
    loadRooms();
    roomSelect.value = room.id;
    selectedRoomId = room.id;
    orchestrationHistory = [];
    renderTeamMessages();
  } catch (error) {
    console.error('Failed to create room:', error);
  }
}

async function handleClearRoom() {
  if (!selectedRoomId) return;
  try {
    await chrome.storage.local.remove(`orch_history_${selectedRoomId}`);
    await clearOrchestrationRoomMessages(selectedRoomId);
    orchestrationHistory = [];
    renderTeamMessages();
    roomMenu.classList.add('hidden');
  } catch (error) {
    console.error('Failed to clear room:', error);
  }
}

// ============ Utility ============

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function autoResize(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
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
    renderAttachmentPreview(chatAttachments, chatPendingAttachments, removeChatAttachment);
    updateChatSendButton();
  } catch (error) {
    console.error('Failed to prepare attachment:', error);
    alert('Failed to upload file. Please try again.');
  } finally {
    isUploadingChat = false;
    btnAttachChat.classList.remove('uploading');
    input.value = '';
  }
}

async function handleTeamFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  isUploadingTeam = true;
  btnAttachTeam.classList.add('uploading');

  try {
    for (const file of Array.from(files)) {
      const attachment = await prepareFileAttachment(file);
      teamPendingAttachments.push(attachment);
    }
    renderAttachmentPreview(teamAttachments, teamPendingAttachments, removeTeamAttachment);
    updateTeamSendButton();
  } catch (error) {
    console.error('Failed to prepare attachment:', error);
    alert('Failed to upload file. Please try again.');
  } finally {
    isUploadingTeam = false;
    btnAttachTeam.classList.remove('uploading');
    input.value = '';
  }
}

function removeChatAttachment(index: number) {
  chatPendingAttachments.splice(index, 1);
  renderAttachmentPreview(chatAttachments, chatPendingAttachments, removeChatAttachment);
  updateChatSendButton();
}

function removeTeamAttachment(index: number) {
  teamPendingAttachments.splice(index, 1);
  renderAttachmentPreview(teamAttachments, teamPendingAttachments, removeTeamAttachment);
  updateTeamSendButton();
}

function updateChatSendButton() {
  const hasContent = chatInput.value.trim().length > 0 || chatPendingAttachments.length > 0;
  (btnSendChat as HTMLButtonElement).disabled = !hasContent || !selectedPersonaId;
}

function updateTeamSendButton() {
  const hasContent = teamInput.value.trim().length > 0 || teamPendingAttachments.length > 0;
  (btnSendTeam as HTMLButtonElement).disabled = !hasContent || !selectedRoomId;
}

function clearChatAttachments() {
  chatPendingAttachments = [];
  renderAttachmentPreview(chatAttachments, chatPendingAttachments, removeChatAttachment);
}

function clearTeamAttachments() {
  teamPendingAttachments = [];
  renderAttachmentPreview(teamAttachments, teamPendingAttachments, removeTeamAttachment);
}

// ============ Event Listeners ============

// Navigation
navTabs.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const tab = target.getAttribute('data-tab');
  if (tab === 'chat' || tab === 'team' || tab === 'settings') {
    showTab(tab);
  }
});

// Pairing
btnPair.addEventListener('click', handlePair);
pairingCode.addEventListener('input', () => {
  pairingCode.value = pairingCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
pairingCode.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handlePair();
});

// Settings
btnDisconnect.addEventListener('click', handleDisconnect);

// Error
btnRetry.addEventListener('click', loadStatus);

// Chat
personaSelect.addEventListener('change', () => {
  selectedPersonaId = personaSelect.value || null;
  if (selectedPersonaId) {
    loadChatHistory();
  } else {
    chatHistory = [];
    renderChatMessages();
  }
  updateChatSendButton();
});

chatInput.addEventListener('input', () => {
  autoResize(chatInput);
  updateChatSendButton();
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendChat();
  }
});

btnSendChat.addEventListener('click', handleSendChat);
btnClearChat.addEventListener('click', handleClearChatHistory);

// Chat attachments
btnAttachChat.addEventListener('click', () => {
  if (!isUploadingChat) {
    chatFileInput.click();
  }
});
chatFileInput.addEventListener('change', handleChatFileSelect);

// Team
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
      renderTeamMessages();
    }
  }
  updateTeamSendButton();
});

teamInput.addEventListener('input', () => {
  autoResize(teamInput);
  updateTeamSendButton();
});

teamInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendTeam();
  }
});

btnSendTeam.addEventListener('click', handleSendTeam);

// Team attachments
btnAttachTeam.addEventListener('click', () => {
  if (!isUploadingTeam) {
    teamFileInput.click();
  }
});
teamFileInput.addEventListener('change', handleTeamFileSelect);

btnRoomMenu.addEventListener('click', () => {
  roomMenu.classList.toggle('hidden');
});

btnClearRoom.addEventListener('click', handleClearRoom);

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!btnRoomMenu.contains(e.target as Node) && !roomMenu.contains(e.target as Node)) {
    roomMenu.classList.add('hidden');
  }
});

// ============ Learning Tab ============

interface LearningStats {
  totalPatterns: number;
  totalActions: number;
  patternHitRate: number;
  successRate: number;
  topDomains: Array<{ domain: string; patterns: number }>;
}

async function loadLearningStats() {
  try {
    const stats = await sendMessage({ type: 'GET_LEARNING_STATS' }) as LearningStats | undefined;

    if (stats) {
      statPatterns.textContent = String(stats.totalPatterns);
      statActions.textContent = String(stats.totalActions);
      statHitRate.textContent = `${Math.round(stats.patternHitRate * 100)}%`;
      statSuccessRate.textContent = `${Math.round(stats.successRate * 100)}%`;

      if (stats.topDomains.length > 0) {
        topDomains.innerHTML = stats.topDomains.map(d =>
          `<li><span>${d.domain}</span><span class="domain-count">${d.patterns}</span></li>`
        ).join('');
      } else {
        topDomains.innerHTML = '<li class="empty-state">No patterns learned yet</li>';
      }
    }

    const settings = await sendMessage({ type: 'GET_LEARNING_SETTINGS' }) as { enableLearning: boolean } | undefined;
    if (settings) {
      learningEnabled.checked = settings.enableLearning;
    }
  } catch (error) {
    console.error('[SidePanel] Failed to load learning stats:', error);
  }
}

learningEnabled.addEventListener('change', async () => {
  await sendMessage({ type: 'SET_LEARNING_ENABLED', payload: { enabled: learningEnabled.checked } });
});

btnClearPatterns.addEventListener('click', async () => {
  if (confirm('Clear all learned patterns? This cannot be undone.')) {
    await sendMessage({ type: 'CLEAR_PATTERNS' });
    loadLearningStats();
  }
});

btnExportPatterns.addEventListener('click', async () => {
  const patterns = await sendMessage({ type: 'EXPORT_PATTERNS' }) as unknown[];
  if (patterns && patterns.length > 0) {
    const blob = new Blob([JSON.stringify(patterns, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawku-patterns-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    alert('No patterns to export');
  }
});

// ============ Consent/Feedback Handlers ============

let currentConsentActionId: string | null = null;
let currentFeedbackId: string | null = null;
let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

function showConsentPrompt(action: {
  id: string;
  description: string;
  domain: string;
  action: string;
}) {
  currentConsentActionId = action.id;
  consentDescription.textContent = action.description;
  consentDomain.textContent = action.domain;
  consentAction.textContent = action.action;
  consentRememberCheckbox.checked = false;
  consentOverlay.classList.remove('hidden');
}

function hideConsentPrompt() {
  consentOverlay.classList.add('hidden');
  currentConsentActionId = null;
}

function showFeedbackPrompt(feedback: {
  id: string;
  description: string;
  expiresAt: number;
}) {
  currentFeedbackId = feedback.id;
  feedbackDescription.textContent = feedback.description || 'Did this work?';
  feedbackToast.classList.remove('hidden');

  feedbackProgressBar.style.animation = 'none';
  feedbackProgressBar.offsetHeight;
  const duration = Math.max(0, feedback.expiresAt - Date.now());
  feedbackProgressBar.style.animation = `countdown ${duration}ms linear forwards`;

  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => {
    hideFeedbackPrompt();
  }, duration);
}

function hideFeedbackPrompt() {
  feedbackToast.classList.add('hidden');
  currentFeedbackId = null;
  if (feedbackTimeout) {
    clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
  }
}

btnConsentDeny.addEventListener('click', () => {
  if (currentConsentActionId) {
    sendMessage({
      type: 'CONSENT_RESPONSE',
      payload: {
        actionId: currentConsentActionId,
        approved: false,
        rememberForDomain: consentRememberCheckbox.checked,
      },
    });
    hideConsentPrompt();
  }
});

btnConsentAllow.addEventListener('click', () => {
  if (currentConsentActionId) {
    sendMessage({
      type: 'CONSENT_RESPONSE',
      payload: {
        actionId: currentConsentActionId,
        approved: true,
        rememberForDomain: consentRememberCheckbox.checked,
      },
    });
    hideConsentPrompt();
  }
});

btnFeedbackGood.addEventListener('click', () => {
  if (currentFeedbackId) {
    sendMessage({
      type: 'FEEDBACK_RESPONSE',
      payload: { feedbackId: currentFeedbackId, feedback: 'good' },
    });
    hideFeedbackPrompt();
  }
});

btnFeedbackBad.addEventListener('click', () => {
  if (currentFeedbackId) {
    sendMessage({
      type: 'FEEDBACK_RESPONSE',
      payload: { feedbackId: currentFeedbackId, feedback: 'bad' },
    });
    hideFeedbackPrompt();
  }
});

// Listen for consent/feedback requests from background
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'CONSENT_REQUEST') {
    showConsentPrompt(message.payload);
  } else if (message.type === 'FEEDBACK_REQUEST') {
    showFeedbackPrompt(message.payload);
  }
});

// ============ Initialize ============

loadStatus();
