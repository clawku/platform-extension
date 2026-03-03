import type {
  BrowserAction,
  BrowserActionParams,
  BrowserActRequest,
  BrowserActKind,
  BrowserResultPayload,
} from '../types/messages.js';

interface CommandResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a browser command from platform-api
 * Supports both OpenClaw format (action=act with kind=...) and direct actions
 */
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
      case 'console':
        return await getConsole(params);

      // OpenClaw 'act' wrapper - routes to specific action based on kind
      case 'act':
        return await executeAct(params);

      // Direct actions (legacy support)
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

      // Unsupported OpenClaw actions - return helpful error messages
      case 'start':
      case 'stop':
        return {
          success: true,
          result: {
            ok: true,
            note: 'Browser control via Clawku extension - browser is always running',
          },
        };
      case 'profiles':
        return {
          success: true,
          result: {
            profiles: ['clawku-extension'],
            current: 'clawku-extension',
            note: 'Clawku extension controls your actual Chrome browser',
          },
        };
      case 'pdf':
        return {
          success: false,
          error: 'PDF export not supported via extension. Use screenshot instead.',
        };
      case 'upload':
        return {
          success: false,
          error: 'File upload not supported via extension.',
        };
      case 'dialog':
        return {
          success: false,
          error: 'Dialog handling not supported via extension.',
        };

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

/**
 * Handle OpenClaw 'act' action which wraps all interactions
 * Supports both nested format (request={kind, ref, ...}) and flattened (kind, ref, ...)
 */
async function executeAct(params: BrowserActionParams): Promise<CommandResult> {
  // Extract act parameters - support both nested (request) and flattened forms
  const request = params.request;
  const kind: BrowserActKind | undefined = request?.kind || params.kind;

  if (!kind) {
    return { success: false, error: 'act action requires "kind" parameter (click, type, scroll, etc.)' };
  }

  // Merge params: nested request takes precedence, then flattened params
  const actParams: BrowserActionParams = {
    ...params,
    ...(request || {}),
  };

  console.log('[Commands] Act:', kind, actParams);

  switch (kind) {
    case 'click':
      return await executeContentAction('click', actParams);
    case 'type':
      return await executeContentAction('type', actParams);
    case 'press':
      return await executeContentAction('press', actParams);
    case 'hover':
      return await executeContentAction('hover', actParams);
    case 'scroll':
      return await executeContentAction('scroll', actParams);
    case 'select':
      return await executeContentAction('select', actParams);
    case 'drag':
      return await executeContentAction('drag', actParams);
    case 'fill':
      return await executeFillForm(actParams);
    case 'wait':
      return await executeWait(actParams);
    case 'close':
      return await closeTab(actParams);
    case 'resize':
      return {
        success: false,
        error: 'Window resize not supported via extension',
      };
    case 'evaluate':
      return await executeEvaluate(actParams);
    default:
      return { success: false, error: `Unknown act kind: ${kind}` };
  }
}

/**
 * Execute form fill action
 */
async function executeFillForm(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.fields || params.fields.length === 0) {
    return { success: false, error: 'fill action requires fields parameter' };
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
    return { success: false, error: 'No tab for fill action' };
  }

  // Execute fill in content script
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillFormFields,
    args: [params.fields],
  });

  if (!results || results.length === 0) {
    return { success: false, error: 'Failed to execute fill' };
  }

  return results[0].result as CommandResult;
}

// Fill form fields in page context
function fillFormFields(fields: Array<Record<string, unknown>>): CommandResult {
  try {
    for (const field of fields) {
      const selector = field.selector as string;
      const ref = field.ref as string;
      const value = field.value as string;

      let element: Element | null = null;

      if (selector) {
        element = document.querySelector(selector);
      } else if (ref) {
        // Try to find by data-ref or other mechanisms
        element = document.querySelector(`[data-ref="${ref}"]`);
      }

      if (element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    return { success: true, result: { filled: fields.length } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Execute wait action
 */
async function executeWait(params: BrowserActionParams): Promise<CommandResult> {
  const timeMs = params.timeMs || params.timeoutMs || 1000;

  // Simple delay
  await new Promise(resolve => setTimeout(resolve, timeMs));

  // If selector specified, wait for element
  if (params.selector) {
    let tabId = params.targetId;
    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = activeTab?.id;
    }

    if (tabId) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: waitForSelector,
        args: [params.selector, params.timeoutMs || 10000],
      });

      if (results && results.length > 0) {
        return results[0].result as CommandResult;
      }
    }
  }

  return { success: true, result: { waited: timeMs } };
}

// Wait for selector in page context
function waitForSelector(selector: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve({ success: true, result: { found: true, selector } });
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        resolve({ success: false, error: `Timeout waiting for ${selector}` });
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
}

/**
 * Execute JavaScript evaluation
 */
async function executeEvaluate(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.fn) {
    return { success: false, error: 'evaluate action requires fn parameter' };
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
    return { success: false, error: 'No tab for evaluate' };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (fnString: string) => {
        try {
          // eslint-disable-next-line no-eval
          const result = eval(fnString);
          return { success: true, result };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
      args: [params.fn],
    });

    if (!results || results.length === 0) {
      return { success: false, error: 'Failed to evaluate' };
    }

    return results[0].result as CommandResult;
  } catch (error) {
    return { success: false, error: String(error) };
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
    targetId: String(tab.id), // OpenClaw expects string targetId
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
    type: 'page',
  }));

  return {
    success: true,
    result: { tabs: tabList },
  };
}

async function openTab(params: BrowserActionParams): Promise<CommandResult> {
  // Support both 'url' and 'targetUrl' (OpenClaw uses targetUrl)
  const url = params.url || params.targetUrl;
  if (!url) {
    return { success: false, error: 'URL is required (url or targetUrl)' };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  return {
    success: true,
    result: {
      ok: true,
      tabId: tab.id,
      targetId: String(tab.id),
      url: tab.url,
    },
  };
}

async function closeTab(params: BrowserActionParams): Promise<CommandResult> {
  const tabId = params.targetId
    ? typeof params.targetId === 'string'
      ? parseInt(params.targetId, 10)
      : params.targetId
    : undefined;

  if (tabId && !isNaN(tabId)) {
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

  const tabId = typeof params.targetId === 'string' ? parseInt(params.targetId, 10) : params.targetId;
  if (isNaN(tabId)) {
    return { success: false, error: 'Invalid tab ID' };
  }

  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return { success: true, result: { focused: params.targetId } };
}

async function navigateTab(params: BrowserActionParams): Promise<CommandResult> {
  // Support both 'url' and 'targetUrl' (OpenClaw uses targetUrl)
  const url = params.url || params.targetUrl;
  if (!url) {
    return { success: false, error: 'URL is required (url or targetUrl)' };
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

  await chrome.tabs.update(tabId, { url });
  return {
    success: true,
    result: {
      ok: true,
      targetId: String(tabId),
      url,
    },
  };
}

async function takeScreenshot(
  params: BrowserActionParams
): Promise<CommandResult> {
  const format = params.format || 'png';
  const quality = params.quality || 90;

  // Get the target tab
  let tabId: number | undefined = params.targetId
    ? typeof params.targetId === 'string'
      ? parseInt(params.targetId, 10)
      : params.targetId
    : undefined;

  if (!tabId || isNaN(tabId)) {
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

  const format = params.snapshotFormat || 'ai';
  const maxChars = params.maxChars || 8000;

  // First, ensure content script is loaded
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
  } catch {
    // Script might already be loaded
  }

  // Use content script's snapshot generation so refs persist for subsequent actions
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_SNAPSHOT',
      payload: { format, maxChars },
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Snapshot failed');
    }

    const snapshotData = response.result as {
      url: string;
      title: string;
      snapshot: string;
      refCount?: number;
    };

    // Return in OpenClaw expected format
    return {
      success: true,
      result: {
        url: snapshotData.url,
        title: snapshotData.title,
        snapshot: snapshotData.snapshot,
        format,
        targetId: String(tabId),
        truncated: snapshotData.snapshot.endsWith('...'),
        stats: { refs: snapshotData.refCount || 0 },
      },
    };
  } catch {
    // Fallback to direct execution if content script messaging fails
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: generatePageSnapshot,
      args: [format, maxChars],
    });

    if (!results || results.length === 0) {
      return { success: false, error: 'Failed to get snapshot' };
    }

    const snapshotData = results[0].result as {
      url: string;
      title: string;
      snapshot: string;
      format: string;
    };

    return {
      success: true,
      result: {
        ...snapshotData,
        targetId: String(tabId),
        truncated: snapshotData.snapshot.endsWith('...'),
      },
    };
  }
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
