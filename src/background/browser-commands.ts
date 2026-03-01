import type {
  BrowserAction,
  BrowserActionParams,
  BrowserResultPayload,
} from '../types/messages.js';

interface CommandResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export async function executeCommand(
  action: BrowserAction,
  params: BrowserActionParams
): Promise<CommandResult> {
  console.log('[Commands] Executing:', action, params);

  try {
    switch (action) {
      case 'status':
        return await getStatus();
      case 'tabs':
        return await getTabs();
      case 'open':
        return await openTab(params);
      case 'close':
        return await closeTab(params);
      case 'focus':
        return await focusTab(params);
      case 'navigate':
        return await navigateTab(params);
      case 'screenshot':
        return await takeScreenshot(params);
      case 'snapshot':
        return await getSnapshot(params);
      case 'click':
        return await executeContentAction('click', params);
      case 'type':
        return await executeContentAction('type', params);
      case 'press':
        return await executeContentAction('press', params);
      case 'hover':
        return await executeContentAction('hover', params);
      case 'scroll':
        return await executeContentAction('scroll', params);
      case 'select':
        return await executeContentAction('select', params);
      case 'console':
        return await getConsole(params);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error('[Commands] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getStatus(): Promise<CommandResult> {
  const tabs = await chrome.tabs.query({});
  return {
    success: true,
    result: {
      tabCount: tabs.length,
      extensionVersion: chrome.runtime.getManifest().version,
    },
  };
}

async function getTabs(): Promise<CommandResult> {
  const tabs = await chrome.tabs.query({});
  const tabList = tabs.map((tab) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
  }));

  return {
    success: true,
    result: { tabs: tabList },
  };
}

async function openTab(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.url) {
    return { success: false, error: 'URL is required' };
  }

  const tab = await chrome.tabs.create({ url: params.url, active: true });
  return {
    success: true,
    result: { tabId: tab.id, url: tab.url },
  };
}

async function closeTab(params: BrowserActionParams): Promise<CommandResult> {
  const tabId = params.targetId;

  if (tabId) {
    await chrome.tabs.remove(tabId);
  } else {
    // Close active tab
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab?.id) {
      await chrome.tabs.remove(activeTab.id);
    }
  }

  return { success: true, result: { closed: true } };
}

async function focusTab(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.targetId) {
    return { success: false, error: 'Tab ID is required' };
  }

  await chrome.tabs.update(params.targetId, { active: true });
  const tab = await chrome.tabs.get(params.targetId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return { success: true, result: { focused: params.targetId } };
}

async function navigateTab(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.url) {
    return { success: false, error: 'URL is required' };
  }

  let tabId = params.targetId;

  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = activeTab?.id;
  }

  if (!tabId) {
    return { success: false, error: 'No tab to navigate' };
  }

  await chrome.tabs.update(tabId, { url: params.url });
  return { success: true, result: { navigated: params.url } };
}

async function takeScreenshot(
  params: BrowserActionParams
): Promise<CommandResult> {
  const format = params.format || 'png';
  const quality = params.quality || 90;

  // Get the target tab
  let tabId = params.targetId;
  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = activeTab?.id;
  }

  if (!tabId) {
    return { success: false, error: 'No tab to screenshot' };
  }

  // Ensure tab is focused for capture
  const tab = await chrome.tabs.get(tabId);
  if (!tab.windowId) {
    return { success: false, error: 'Tab has no window' };
  }

  // Capture visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: format as 'png' | 'jpeg',
    quality: format === 'jpeg' ? quality : undefined,
  });

  return {
    success: true,
    result: {
      dataUrl,
      format,
      tabId,
      url: tab.url,
      title: tab.title,
    },
  };
}

async function getSnapshot(params: BrowserActionParams): Promise<CommandResult> {
  let tabId = params.targetId;

  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = activeTab?.id;
  }

  if (!tabId) {
    return { success: false, error: 'No tab to snapshot' };
  }

  // Execute content script to get DOM snapshot
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: generatePageSnapshot,
    args: [params.snapshotFormat || 'ai', params.maxChars || 8000],
  });

  if (!results || results.length === 0) {
    return { success: false, error: 'Failed to get snapshot' };
  }

  return {
    success: true,
    result: results[0].result,
  };
}

// This function runs in the page context
function generatePageSnapshot(format: string, maxChars: number): unknown {
  const refs = new Map<string, Element>();
  let refCounter = 0;

  function getElementRef(el: Element): string {
    const ref = `e${refCounter++}`;
    refs.set(ref, el);
    return ref;
  }

  function isInteractive(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const interactiveTags = [
      'a',
      'button',
      'input',
      'select',
      'textarea',
      'details',
      'summary',
    ];
    const interactiveRoles = [
      'button',
      'link',
      'checkbox',
      'radio',
      'textbox',
      'combobox',
      'menuitem',
      'tab',
    ];

    return (
      interactiveTags.includes(tag) ||
      (role !== null && interactiveRoles.includes(role)) ||
      el.hasAttribute('onclick') ||
      el.hasAttribute('tabindex')
    );
  }

  function getElementText(el: Element): string {
    // Get direct text content, not from children
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent?.trim() || '';
      }
    }
    return text.slice(0, 100);
  }

  function serializeElement(el: Element, depth: number = 0): string {
    if (depth > 10) return '';
    const indent = '  '.repeat(depth);
    const tag = el.tagName.toLowerCase();

    // Skip hidden elements
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return '';
    }

    // Skip script, style, etc.
    if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) {
      return '';
    }

    let line = `${indent}[${tag}]`;

    // Add ref for interactive elements
    if (isInteractive(el)) {
      const ref = getElementRef(el);
      line += ` (${ref})`;
    }

    // Add relevant attributes
    const id = el.getAttribute('id');
    const className = el.getAttribute('class');
    const href = el.getAttribute('href');
    const src = el.getAttribute('src');
    const type = el.getAttribute('type');
    const placeholder = el.getAttribute('placeholder');
    const ariaLabel = el.getAttribute('aria-label');
    const value = (el as HTMLInputElement).value;

    if (id) line += ` id="${id}"`;
    if (ariaLabel) line += ` "${ariaLabel}"`;
    if (href) line += ` href="${href.slice(0, 50)}"`;
    if (type) line += ` type="${type}"`;
    if (placeholder) line += ` placeholder="${placeholder}"`;
    if (value && tag === 'input') line += ` value="${value.slice(0, 30)}"`;

    // Add text content
    const text = getElementText(el);
    if (text) {
      line += ` "${text}"`;
    }

    let result = line + '\n';

    // Recurse into children
    for (const child of el.children) {
      result += serializeElement(child, depth + 1);
    }

    return result;
  }

  const snapshot = serializeElement(document.body);
  const truncated =
    snapshot.length > maxChars ? snapshot.slice(0, maxChars) + '\n...' : snapshot;

  return {
    url: window.location.href,
    title: document.title,
    snapshot: truncated,
    format,
  };
}

async function executeContentAction(
  action: string,
  params: BrowserActionParams
): Promise<CommandResult> {
  let tabId = params.targetId;

  if (!tabId) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = activeTab?.id;
  }

  if (!tabId) {
    return { success: false, error: 'No tab for action' };
  }

  // Send message to content script
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_ACTION',
      payload: { action, params },
    });

    return response;
  } catch (error) {
    // Content script might not be loaded, inject and retry
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });

    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_ACTION',
      payload: { action, params },
    });

    return response;
  }
}

async function getConsole(params: BrowserActionParams): Promise<CommandResult> {
  // Console messages need to be captured via content script
  // For now, return a placeholder
  return {
    success: true,
    result: {
      messages: [],
      note: 'Console capture requires page injection',
    },
  };
}

export function createResultPayload(
  jobId: string,
  nonce: string,
  result: CommandResult
): BrowserResultPayload {
  return {
    jobId,
    status: result.success ? 'COMPLETED' : 'FAILED',
    result: result.result,
    errorText: result.error,
    nonce,
    issuedAt: Date.now(),
  };
}
