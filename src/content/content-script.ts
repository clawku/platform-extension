import type {
  ContentScriptMessage,
  ContentScriptResponse,
  BrowserActionParams,
} from '../types/messages.js';

console.log('[ContentScript] Clawku Browser Extension loaded');

// Store element references from snapshots
const elementRefs = new Map<string, Element>();

// Listen for messages from background script
chrome.runtime.onMessage.addListener(
  (
    message: ContentScriptMessage,
    _sender,
    sendResponse: (response: ContentScriptResponse) => void
  ) => {
    console.log('[ContentScript] Received message:', message.type);

    if (message.type === 'PING') {
      sendResponse({ success: true, result: 'pong' });
      return true;
    }

    if (message.type === 'EXECUTE_ACTION') {
      const payload = message.payload as {
        action: string;
        params: BrowserActionParams;
      };

      executeAction(payload.action, payload.params)
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );

      return true; // Keep channel open for async response
    }

    if (message.type === 'GET_SNAPSHOT') {
      const result = generateSnapshot();
      sendResponse({ success: true, result });
      return true;
    }

    return false;
  }
);

async function executeAction(
  action: string,
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  console.log('[ContentScript] Executing action:', action, params);

  switch (action) {
    case 'click':
      return await performClick(params);
    case 'type':
      return await performType(params);
    case 'press':
      return await performKeyPress(params);
    case 'hover':
      return await performHover(params);
    case 'scroll':
      return await performScroll(params);
    case 'select':
      return await performSelect(params);
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

function findElement(params: BrowserActionParams): Element | null {
  // Find by ref first
  if (params.ref && elementRefs.has(params.ref)) {
    return elementRefs.get(params.ref) || null;
  }

  // TODO: Add more selectors (CSS selector, XPath, text content)
  return null;
}

async function performClick(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  if (!element) {
    return { success: false, error: 'Element not found' };
  }

  // Scroll into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(100);

  // Create and dispatch click event
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const clickEvent = new MouseEvent(params.doubleClick ? 'dblclick' : 'click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: params.button === 'right' ? 2 : params.button === 'middle' ? 1 : 0,
    shiftKey: params.modifiers?.includes('shift'),
    ctrlKey: params.modifiers?.includes('ctrl'),
    altKey: params.modifiers?.includes('alt'),
    metaKey: params.modifiers?.includes('meta'),
  });

  element.dispatchEvent(clickEvent);

  // Also try native click for buttons/links
  if (element instanceof HTMLElement) {
    element.click();
  }

  return {
    success: true,
    result: { clicked: true, tagName: element.tagName },
  };
}

async function performType(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  if (!element) {
    // Try to use active element
    const activeEl = document.activeElement;
    if (
      !activeEl ||
      !(
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement
      )
    ) {
      return { success: false, error: 'No input element found or focused' };
    }
  }

  const inputEl =
    (element as HTMLInputElement | HTMLTextAreaElement) ||
    (document.activeElement as HTMLInputElement | HTMLTextAreaElement);

  if (
    !(inputEl instanceof HTMLInputElement) &&
    !(inputEl instanceof HTMLTextAreaElement)
  ) {
    return { success: false, error: 'Element is not an input' };
  }

  // Focus the element
  inputEl.focus();
  await sleep(50);

  const text = params.text || '';

  if (params.slowly) {
    // Type character by character
    for (const char of text) {
      inputEl.value += char;
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
      await sleep(50);
    }
  } else {
    // Type all at once
    inputEl.value = text;
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }

  // Dispatch change event
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));

  // Submit if requested
  if (params.submit) {
    const form = inputEl.closest('form');
    if (form) {
      form.submit();
    } else {
      // Simulate Enter key
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
    }
  }

  return { success: true, result: { typed: text.length } };
}

async function performKeyPress(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const key = params.key || '';
  const element = document.activeElement || document.body;

  const keydownEvent = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    shiftKey: params.modifiers?.includes('shift'),
    ctrlKey: params.modifiers?.includes('ctrl'),
    altKey: params.modifiers?.includes('alt'),
    metaKey: params.modifiers?.includes('meta'),
  });

  const keyupEvent = new KeyboardEvent('keyup', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  });

  element.dispatchEvent(keydownEvent);
  await sleep(50);
  element.dispatchEvent(keyupEvent);

  return { success: true, result: { pressed: key } };
}

async function performHover(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  if (!element) {
    return { success: false, error: 'Element not found' };
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(100);

  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const mouseoverEvent = new MouseEvent('mouseover', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  });

  const mouseenterEvent = new MouseEvent('mouseenter', {
    bubbles: false,
    cancelable: false,
    view: window,
    clientX: x,
    clientY: y,
  });

  element.dispatchEvent(mouseoverEvent);
  element.dispatchEvent(mouseenterEvent);

  return { success: true, result: { hovered: true } };
}

async function performScroll(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const direction = params.direction || 'down';
  const amount = params.amount || 300;

  let x = 0;
  let y = 0;

  switch (direction) {
    case 'up':
      y = -amount;
      break;
    case 'down':
      y = amount;
      break;
    case 'left':
      x = -amount;
      break;
    case 'right':
      x = amount;
      break;
  }

  window.scrollBy({ left: x, top: y, behavior: 'smooth' });
  await sleep(300);

  return {
    success: true,
    result: {
      scrolled: direction,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
  };
}

async function performSelect(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  if (!element || !(element instanceof HTMLSelectElement)) {
    return { success: false, error: 'Select element not found' };
  }

  const values = params.values || [];

  for (const option of element.options) {
    option.selected = values.includes(option.value);
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true, result: { selected: values } };
}

function generateSnapshot(): unknown {
  elementRefs.clear();
  let refCounter = 0;

  function getElementRef(el: Element): string {
    const ref = `e${refCounter++}`;
    elementRefs.set(ref, el);
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

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return '';
    }

    if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) {
      return '';
    }

    let line = `${indent}[${tag}]`;

    if (isInteractive(el)) {
      const ref = getElementRef(el);
      line += ` (${ref})`;
    }

    const id = el.getAttribute('id');
    const ariaLabel = el.getAttribute('aria-label');
    const href = el.getAttribute('href');
    const type = el.getAttribute('type');
    const placeholder = el.getAttribute('placeholder');

    if (id) line += ` id="${id}"`;
    if (ariaLabel) line += ` "${ariaLabel}"`;
    if (href) line += ` href="${href.slice(0, 50)}"`;
    if (type) line += ` type="${type}"`;
    if (placeholder) line += ` placeholder="${placeholder}"`;

    const text = getElementText(el);
    if (text) {
      line += ` "${text}"`;
    }

    let result = line + '\n';

    for (const child of el.children) {
      result += serializeElement(child, depth + 1);
    }

    return result;
  }

  const snapshot = serializeElement(document.body);

  return {
    url: window.location.href,
    title: document.title,
    snapshot: snapshot.slice(0, 8000),
    refCount: refCounter,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
