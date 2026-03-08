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
      const payload = message.payload as { format?: string; maxChars?: number } | undefined;
      const maxChars = payload?.maxChars || 8000;
      const result = generateSnapshot(maxChars);
      sendResponse({ success: true, result });
      return true;
    }

    if (message.type === 'EVALUATE') {
      const payload = message.payload as { fn: string };
      try {
        // Inject script into page context to bypass CSP
        const script = document.createElement('script');
        const resultId = `__clawku_eval_${Date.now()}`;
        script.textContent = `
          try {
            window['${resultId}'] = { success: true, result: eval(${JSON.stringify(payload.fn)}) };
          } catch (e) {
            window['${resultId}'] = { success: false, error: String(e) };
          }
        `;
        document.documentElement.appendChild(script);
        script.remove();

        // Get result from window
        const result = (window as unknown as Record<string, unknown>)[resultId] as { success: boolean; result?: unknown; error?: string };
        delete (window as unknown as Record<string, unknown>)[resultId];

        sendResponse(result || { success: false, error: 'No result' });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
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
    case 'rapidClick':
      return await performRapidClick(params);
    case 'clickAll':
      return await performClickAll(params);
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
    case 'drag':
      return await performDrag(params);
    case 'click_send_button':
      return await performClickSendButton(params);
    case 'find_comment_input':
      return await performFindCommentInput(params);
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/**
 * Click the send button (TikTok, Instagram, etc.)
 */
async function performClickSendButton(
  _params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const sendButton = findTikTokSendButton();
  if (!sendButton) {
    return { success: false, error: 'Send button not found' };
  }

  // Scroll into view
  sendButton.scrollIntoView({ behavior: 'instant', block: 'center' });
  await sleep(50);

  // Click the send button
  const rect = sendButton.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const mousedown = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  });

  const mouseup = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  });

  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  });

  sendButton.dispatchEvent(mousedown);
  sendButton.dispatchEvent(mouseup);
  sendButton.dispatchEvent(click);

  if (sendButton instanceof HTMLElement) {
    sendButton.click();
  }

  return {
    success: true,
    result: { clicked: true, tagName: sendButton.tagName, type: 'send_button' },
  };
}

/**
 * Find and focus the comment input field
 */
async function performFindCommentInput(
  _params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const url = window.location.hostname;

  let commentInput: Element | null = null;

  if (url.includes('tiktok.com')) {
    const selectors = [
      '[data-e2e="comment-input"]',
      '[data-e2e*="comment"] [contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder*="comment" i]',
      'div[contenteditable="true"][data-placeholder*="Comment" i]',
      'div[contenteditable="true"][data-placeholder*="Add comment" i]',
      'div[contenteditable="true"][data-placeholder*="Say something" i]',
      '.tiktok-live-chat-input [contenteditable="true"]',
      'div[class*="CommentInput"] [contenteditable="true"]',
      'div[class*="comment-input"] [contenteditable="true"]',
      'div[class*="ChatInput"] [contenteditable="true"]',
      'div[class*="DivInputContainer"] [contenteditable="true"]',
      '[contenteditable="true"]:not([style*="display: none"])',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            commentInput = el;
            console.log(`[ContentScript] Found comment input: ${sel}`);
            break;
          }
        }
      } catch {
        // Invalid selector
      }
    }
  }

  if (!commentInput) {
    // Generic fallback
    commentInput = document.querySelector('[contenteditable="true"]');
  }

  if (!commentInput) {
    return { success: false, error: 'Comment input not found' };
  }

  // Focus the element
  if (commentInput instanceof HTMLElement) {
    commentInput.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(50);
    commentInput.focus();
    commentInput.click();
  }

  // Get position for CDP-based actions
  const rect = commentInput.getBoundingClientRect();

  return {
    success: true,
    result: {
      found: true,
      tagName: commentInput.tagName,
      isContentEditable: (commentInput as HTMLElement).isContentEditable,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    },
  };
}

function findElement(params: BrowserActionParams): Element | null {
  // Find by ref first
  if (params.ref && elementRefs.has(params.ref)) {
    return elementRefs.get(params.ref) || null;
  }

  // Find by CSS selector
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (el) return el;
    console.log(`[ContentScript] Selector "${params.selector}" not found, will try fallbacks...`);
  }

  // Find by XPath
  if (params.xpath) {
    const result = document.evaluate(params.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue as Element | null;
  }

  // Find by text content
  if (params.text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(params.text)) {
        return node.parentElement;
      }
    }
  }

  // If ref/selector not found, try to find by aria-label or common patterns
  if (params.ref || params.selector) {
    console.log(`[ContentScript] Element not found (ref=${params.ref}, selector=${params.selector}), trying fallback selectors...`);

    // Detect site and use site-specific selectors
    const url = window.location.hostname;
    let siteSelectors: string[] = [];

    if (url.includes('tiktok.com')) {
      console.log(`[ContentScript] Detected TikTok, using TikTok-specific selectors`);

      // Check if looking for comment input
      const isCommentInput = params.selector?.toLowerCase().includes('comment') ||
        params.ref?.toLowerCase().includes('comment') ||
        params.text !== undefined; // If we're trying to type, likely comment input

      if (isCommentInput) {
        siteSelectors = [
          // TikTok Live comment input - contenteditable div
          '[data-e2e="comment-input"]',
          '[data-e2e*="comment"] [contenteditable="true"]',
          'div[contenteditable="true"][data-placeholder*="comment" i]',
          'div[contenteditable="true"][data-placeholder*="Comment" i]',
          'div[contenteditable="true"][data-placeholder*="Add comment" i]',
          'div[contenteditable="true"][data-placeholder*="Say something" i]',
          // More generic TikTok comment field
          '.tiktok-live-chat-input [contenteditable="true"]',
          'div[class*="CommentInput"] [contenteditable="true"]',
          'div[class*="comment-input"] [contenteditable="true"]',
          'div[class*="ChatInput"] [contenteditable="true"]',
          'div[class*="DivInputContainer"] [contenteditable="true"]',
          // Fallback: any visible contenteditable
          '[contenteditable="true"]:not([style*="display: none"])',
        ];
      } else {
        siteSelectors = [
          // TikTok Live like button - the heart icon container
          'div[class*="DivLikeWrapper"] button',
          'div[class*="like"] button',
          'div[class*="Like"] button',
          // The clickable div with cursor-pointer (heart button)
          'div[aria-haspopup="dialog"]:not(.hidden) div.cursor-pointer',
          'div.cursor-pointer:has(svg)',
          // SVG heart icon
          'svg[viewBox="0 0 48 48"]',
          'path[d*="M24 9.44"]', // The heart path
          // Generic TikTok
          '[data-e2e="like-icon"]',
          '[data-e2e*="like"]',
        ];
      }
    } else if (url.includes('instagram.com')) {
      siteSelectors = [
        'svg[aria-label="Like"]',
        'span[class*="like"]',
        '[aria-label*="Like"]',
      ];
    }

    // Add generic selectors
    const genericSelectors = [
      '[aria-label*="like" i]',
      '[aria-label*="Like"]',
      'button[aria-label*="like" i]',
      '[data-testid*="like"]',
      '.like-button',
      '.like-btn',
    ];

    const allSelectors = [...siteSelectors, ...genericSelectors];

    for (const sel of allSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          console.log(`[ContentScript] Found element via fallback selector: ${sel}`);
          return el;
        }
      } catch {
        // Invalid selector, skip
      }
    }

    console.log(`[ContentScript] No fallback selector matched`);
  }

  return null;
}

/**
 * Find TikTok send button near the comment input
 */
function findTikTokSendButton(): Element | null {
  const selectors = [
    // TikTok Live send button
    '[data-e2e="comment-send-button"]',
    '[data-e2e*="send"]',
    'div[class*="SendButton"]',
    'button[class*="SendButton"]',
    'div[class*="DivSendButton"]',
    // Button near comment input with send icon
    'div[class*="CommentInput"] button',
    'div[class*="comment-input"] button',
    'div[class*="ChatInput"] button',
    // SVG send icon button
    'button:has(svg[class*="send" i])',
    'div:has(svg[class*="send" i])',
    // Aria labels
    '[aria-label*="Send" i]',
    '[aria-label*="Post" i]',
    '[aria-label*="Submit" i]',
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Only return if visible
        if (rect.width > 0 && rect.height > 0) {
          console.log(`[ContentScript] Found TikTok send button: ${sel}`);
          return el;
        }
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Fallback: Look for any clickable element near a contenteditable
  const contentEditable = document.querySelector('[contenteditable="true"]');
  if (contentEditable) {
    const parent = contentEditable.closest('div[class*="Input"], div[class*="Chat"], div[class*="Comment"]');
    if (parent) {
      // Find button siblings
      const buttons = parent.querySelectorAll('button, div[role="button"], [class*="Button"]');
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && btn !== contentEditable) {
          console.log(`[ContentScript] Found send button via parent search`);
          return btn;
        }
      }
    }
  }

  return null;
}

function findAllElements(params: BrowserActionParams): Element[] {
  if (params.selector) {
    return Array.from(document.querySelectorAll(params.selector));
  }
  return [];
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

async function performRapidClick(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  if (!element) {
    return { success: false, error: `Element not found for selector: ${params.selector || params.ref}` };
  }

  const count = params.count || 100;
  const delay = params.delay || 0; // 0 = as fast as possible
  let clicked = 0;

  console.log(`[ContentScript] rapidClick starting: ${count} clicks, ${delay}ms delay`);
  const startTime = performance.now();

  // Scroll into view first
  element.scrollIntoView({ behavior: 'instant', block: 'center' });

  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    // Dispatch mousedown, mouseup, click sequence for maximum compatibility
    const mousedown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    });

    const mouseup = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    });

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    });

    element.dispatchEvent(mousedown);
    element.dispatchEvent(mouseup);
    element.dispatchEvent(click);

    if (element instanceof HTMLElement) {
      element.click();
    }

    clicked++;

    if (delay > 0) {
      await sleep(delay);
    }
  }

  const elapsed = performance.now() - startTime;
  console.log(`[ContentScript] rapidClick done: ${clicked} clicks in ${elapsed.toFixed(0)}ms (${(clicked / (elapsed / 1000)).toFixed(0)} clicks/sec)`);

  return {
    success: true,
    result: { rapidClicked: true, count: clicked, tagName: element.tagName, elapsedMs: elapsed },
  };
}

async function performClickAll(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const elements = findAllElements(params);
  if (elements.length === 0) {
    return { success: false, error: 'No elements found matching selector' };
  }

  const delay = params.delay || 50; // Small delay between elements by default
  let clicked = 0;

  for (const element of elements) {
    const rect = element.getBoundingClientRect();

    // Skip if not visible
    if (rect.width === 0 || rect.height === 0) continue;

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    });

    element.dispatchEvent(click);

    if (element instanceof HTMLElement) {
      element.click();
    }

    clicked++;

    if (delay > 0) {
      await sleep(delay);
    }
  }

  return {
    success: true,
    result: { clickedAll: true, count: clicked, total: elements.length },
  };
}

async function performType(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  const element = findElement(params);
  const activeEl = document.activeElement as HTMLElement;
  const targetEl = element || activeEl;

  if (!targetEl) {
    return { success: false, error: 'No element found or focused' };
  }

  const text = params.text || '';

  // Check if it's a contenteditable element
  if (targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true') {
    // Focus the element
    targetEl.focus();
    await sleep(50);

    // Method 1: Try execCommand (works on many sites)
    const success = document.execCommand('insertText', false, text);

    if (!success) {
      // Method 2: Use Selection API
      const selection = window.getSelection();
      if (selection) {
        // Clear any existing selection
        selection.removeAllRanges();

        // Create a range at the end of the element
        const range = document.createRange();
        range.selectNodeContents(targetEl);
        range.collapse(false); // Collapse to end
        selection.addRange(range);

        // Insert text node
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor after inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    // Dispatch input event to trigger React/Vue handlers
    targetEl.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));

    // Also dispatch textInput event (some frameworks use this)
    const textInputEvent = new InputEvent('textInput', {
      bubbles: true,
      cancelable: true,
      data: text,
    });
    targetEl.dispatchEvent(textInputEvent);

    // Submit if requested
    if (params.submit) {
      targetEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
      targetEl.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
      );
    }

    return { success: true, result: { typed: text.length, method: 'contenteditable' } };
  }

  // Handle standard input/textarea elements
  if (
    !(targetEl instanceof HTMLInputElement) &&
    !(targetEl instanceof HTMLTextAreaElement)
  ) {
    return { success: false, error: 'Element is not an input, textarea, or contenteditable' };
  }

  const inputEl = targetEl as HTMLInputElement | HTMLTextAreaElement;

  // Focus the element
  inputEl.focus();
  await sleep(50);

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

  return { success: true, result: { typed: text.length, method: 'input' } };
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

async function performDrag(
  params: BrowserActionParams
): Promise<ContentScriptResponse> {
  // Get start and end elements
  const startRef = params.startRef || params.ref;
  const endRef = params.endRef;

  if (!startRef || !endRef) {
    return { success: false, error: 'drag requires startRef and endRef' };
  }

  const startElement = elementRefs.get(startRef);
  const endElement = elementRefs.get(endRef);

  if (!startElement) {
    return { success: false, error: `Start element not found: ${startRef}` };
  }
  if (!endElement) {
    return { success: false, error: `End element not found: ${endRef}` };
  }

  // Get element positions
  const startRect = startElement.getBoundingClientRect();
  const endRect = endElement.getBoundingClientRect();

  const startX = startRect.left + startRect.width / 2;
  const startY = startRect.top + startRect.height / 2;
  const endX = endRect.left + endRect.width / 2;
  const endY = endRect.top + endRect.height / 2;

  // Dispatch drag events
  const mousedownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: startX,
    clientY: startY,
    button: 0,
  });

  const mousemoveEvent = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    clientX: endX,
    clientY: endY,
    button: 0,
  });

  const mouseupEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: endX,
    clientY: endY,
    button: 0,
  });

  startElement.dispatchEvent(mousedownEvent);
  await sleep(50);
  document.dispatchEvent(mousemoveEvent);
  await sleep(50);
  endElement.dispatchEvent(mouseupEvent);

  // Also try HTML5 drag and drop API
  const dragstartEvent = new DragEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    clientX: startX,
    clientY: startY,
  });

  const dropEvent = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    clientX: endX,
    clientY: endY,
  });

  const dragendEvent = new DragEvent('dragend', {
    bubbles: true,
    cancelable: true,
    clientX: endX,
    clientY: endY,
  });

  startElement.dispatchEvent(dragstartEvent);
  await sleep(50);
  endElement.dispatchEvent(dropEvent);
  startElement.dispatchEvent(dragendEvent);

  return {
    success: true,
    result: { dragged: true, from: startRef, to: endRef },
  };
}

function generateSnapshot(maxChars: number = 8000): unknown {
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
    const value = (el as HTMLInputElement).value;

    if (id) line += ` id="${id}"`;
    if (ariaLabel) line += ` "${ariaLabel}"`;
    if (href) line += ` href="${href.slice(0, 50)}"`;
    if (type) line += ` type="${type}"`;
    if (placeholder) line += ` placeholder="${placeholder}"`;
    if (value && tag === 'input') line += ` value="${value.slice(0, 30)}"`;

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
  const truncated = snapshot.length > maxChars;
  const finalSnapshot = truncated ? snapshot.slice(0, maxChars) + '\n...' : snapshot;

  return {
    url: window.location.href,
    title: document.title,
    snapshot: finalSnapshot,
    refCount: refCounter,
    truncated,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
