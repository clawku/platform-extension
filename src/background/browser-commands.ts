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
      case 'type_raw':
        return await typeRawViaDebugger(params);
      case 'press':
        return await executeContentAction('press', params);
      case 'press_key':
      case 'key':
        return await pressKeyViaDebugger(params);
      case 'hover':
        return await executeContentAction('hover', params);
      case 'scroll':
        return await executeContentAction('scroll', params);
      case 'select':
        return await executeContentAction('select', params);
      case 'rapidClick':
        return await executeContentAction('rapidClick', params);
      case 'clickAll':
        return await executeContentAction('clickAll', params);
      case 'click_send_button':
        return await executeContentAction('click_send_button', params);
      case 'find_comment_input':
        return await executeContentAction('find_comment_input', params);
      case 'click_at':
        return await clickAtCoordinates(params);
      case 'type_at':
        return await typeAtCoordinates(params);

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
    case 'type_raw':
      return await typeRawViaDebugger(actParams);
    case 'press':
      return await executeContentAction('press', actParams);
    case 'press_key':
      return await pressKeyViaDebugger(actParams);
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
    case 'click_at':
      return await clickAtCoordinates(actParams);
    case 'type_at':
      return await typeAtCoordinates(actParams);
    case 'click_send_button':
      return await executeContentAction('click_send_button', actParams);
    case 'find_comment_input':
      return await executeContentAction('find_comment_input', actParams);
    default:
      return { success: false, error: `Unknown act kind: ${kind}` };
  }
}

/**
 * Type text using Chrome DevTools Protocol (CDP) via chrome.debugger API
 * This bypasses DOM-level anti-bot measures by sending keyboard events at browser level
 */
async function typeRawViaDebugger(params: BrowserActionParams): Promise<CommandResult> {
  const text = params.text;
  if (!text) {
    return { success: false, error: 'type_raw requires text parameter' };
  }

  // Get target tab
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
    return { success: false, error: 'No tab for type_raw' };
  }

  const target = { tabId };

  // Check if debugger API is available - if not, fallback to content script
  if (!chrome.debugger) {
    console.log('[type_raw] chrome.debugger not available, using content script fallback');
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (inputText: string) => {
          // Find active/focused element or any input field
          let element = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
          if (!element || (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && !element.isContentEditable)) {
            // Try to find any visible input field
            const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]');
            for (const input of inputs) {
              const rect = input.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                element = input as HTMLInputElement;
                element.focus();
                break;
              }
            }
          }
          if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
            element.value = inputText;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return { typed: true, element: element.tagName };
          } else if (element && element.isContentEditable) {
            element.textContent = inputText;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            return { typed: true, element: 'contenteditable' };
          }
          return { typed: false, error: 'No input element found' };
        },
        args: [text],
      });
      const result = results[0]?.result;
      if (result?.typed) {
        return { success: true, result: { ...result, method: 'content-script' } };
      }
      return { success: false, error: result?.error || 'Content script type failed' };
    } catch (err) {
      return { success: false, error: `Content script type fallback failed: ${err}` };
    }
  }

  try {
    // Attach debugger to tab
    await chrome.debugger.attach(target, '1.3');
    console.log('[type_raw] Debugger attached to tab', tabId);

    // Type each character using CDP Input.dispatchKeyEvent
    for (const char of text) {
      // Send keyDown event
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: char,
        text: char,
        unmodifiedText: char,
        // windowsVirtualKeyCode and nativeVirtualKeyCode for special handling
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0),
      });

      // Send char event (for text input)
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'char',
        key: char,
        text: char,
        unmodifiedText: char,
      });

      // Send keyUp event
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        text: char,
        unmodifiedText: char,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0),
      });

      // Small delay between characters for more natural typing
      if (params.slowly) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // If submit requested, press Enter using robust key sequence
    if (params.submit) {
      // Small delay after typing before pressing Enter
      await new Promise(resolve => setTimeout(resolve, 100));

      // Use rawKeyDown which is more reliable for special keys
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });

      // Send char event with carriage return (important for some apps)
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'char',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 20));

      // Send keyUp
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }

    console.log('[type_raw] Successfully typed', text.length, 'characters');

    return {
      success: true,
      result: {
        typed: text.length,
        method: 'cdp',
        note: 'Typed via Chrome DevTools Protocol',
      },
    };
  } catch (error) {
    console.error('[type_raw] Error:', error);
    return {
      success: false,
      error: `type_raw failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Always detach debugger
    try {
      await chrome.debugger.detach(target);
      console.log('[type_raw] Debugger detached');
    } catch {
      // Ignore detach errors (might already be detached)
    }
  }
}

/**
 * Key code mappings for CDP Input.dispatchKeyEvent
 */
const KEY_CODES: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
};

/**
 * Press a key using Chrome DevTools Protocol (CDP) via chrome.debugger API
 * This bypasses DOM-level event handling by sending keyboard events at browser level
 * Used for submitting forms on anti-bot sites like TikTok Live
 */
async function pressKeyViaDebugger(params: BrowserActionParams): Promise<CommandResult> {
  const key = params.key || 'Enter';
  const keyInfo = KEY_CODES[key] || { code: key, keyCode: key.charCodeAt(0) };

  // Get target tab
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
    return { success: false, error: 'No tab for press_key' };
  }

  const target = { tabId };

  // Check if debugger API is available - if not, fallback to content script
  if (!chrome.debugger) {
    console.log('[press_key] chrome.debugger not available, using content script fallback');
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (keyName: string) => {
          const activeEl = document.activeElement || document.body;

          // Dispatch keyboard events
          const keydownEvent = new KeyboardEvent('keydown', {
            key: keyName,
            code: keyName,
            keyCode: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            which: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            bubbles: true,
            cancelable: true,
          });

          const keypressEvent = new KeyboardEvent('keypress', {
            key: keyName,
            code: keyName,
            keyCode: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            which: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            bubbles: true,
            cancelable: true,
          });

          const keyupEvent = new KeyboardEvent('keyup', {
            key: keyName,
            code: keyName,
            keyCode: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            which: keyName === 'Enter' ? 13 : keyName.charCodeAt(0),
            bubbles: true,
            cancelable: true,
          });

          activeEl.dispatchEvent(keydownEvent);
          activeEl.dispatchEvent(keypressEvent);
          activeEl.dispatchEvent(keyupEvent);

          return { pressed: true, key: keyName, method: 'content-script' };
        },
        args: [key],
      });
      const result = results[0]?.result;
      if (result?.pressed) {
        return { success: true, result };
      }
      return { success: false, error: 'Content script press_key failed' };
    } catch (err) {
      return { success: false, error: `Content script press_key fallback failed: ${err}` };
    }
  }

  try {
    // Attach debugger to tab
    await chrome.debugger.attach(target, '1.3');
    console.log('[press_key] Debugger attached to tab', tabId);

    // Build event params
    const baseParams = {
      key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
      ...(keyInfo.text ? { text: keyInfo.text } : {}),
    };

    // Add modifier keys if specified
    const modifiers: number =
      (params.modifiers?.includes('alt') ? 1 : 0) +
      (params.modifiers?.includes('ctrl') ? 2 : 0) +
      (params.modifiers?.includes('meta') ? 4 : 0) +
      (params.modifiers?.includes('shift') ? 8 : 0);

    // Send rawKeyDown event (more reliable than keyDown for special keys)
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...baseParams,
      modifiers,
    });

    // Small delay between down and up
    await new Promise(resolve => setTimeout(resolve, 20));

    // For Enter/Space, also send a char event
    if (keyInfo.text) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'char',
        ...baseParams,
        modifiers,
      });
    }

    // Send keyUp event
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...baseParams,
      modifiers,
    });

    console.log('[press_key] Successfully pressed', key);

    return {
      success: true,
      result: {
        pressed: true,
        key,
        code: keyInfo.code,
        keyCode: keyInfo.keyCode,
        method: 'cdp',
        note: 'Key pressed via Chrome DevTools Protocol',
      },
    };
  } catch (error) {
    console.error('[press_key] Error:', error);
    return {
      success: false,
      error: `press_key failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Always detach debugger
    try {
      await chrome.debugger.detach(target);
      console.log('[press_key] Debugger detached');
    } catch {
      // Ignore detach errors
    }
  }
}

/**
 * Click at specific x,y coordinates using Chrome DevTools Protocol (CDP)
 * Used as fallback when DOM-based clicking fails (canvas, shadow DOM, anti-bot sites)
 * Coordinates are obtained from vision AI model
 */
async function clickAtCoordinates(params: BrowserActionParams): Promise<CommandResult> {
  let x = params.x;
  let y = params.y;

  if (typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, error: 'click_at requires x and y coordinate parameters' };
  }

  // Get target tab
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
    return { success: false, error: 'No tab for click_at' };
  }

  // Resolution-agnostic coordinate conversion:
  // If screenshot dimensions provided, convert to ratios then to viewport coords
  // This works regardless of DPR or screen resolution
  const screenshotWidth = params.screenshotWidth;
  const screenshotHeight = params.screenshotHeight;

  if (screenshotWidth && screenshotHeight) {
    try {
      const viewportResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ w: window.innerWidth, h: window.innerHeight }),
      });
      const viewport = viewportResults[0]?.result;
      if (viewport) {
        const xRatio = x / screenshotWidth;
        const yRatio = y / screenshotHeight;
        const newX = Math.round(xRatio * viewport.w);
        const newY = Math.round(yRatio * viewport.h);
        console.log(`[click_at] Resolution agnostic: (${x},${y}) in ${screenshotWidth}x${screenshotHeight} -> ratio (${xRatio.toFixed(3)},${yRatio.toFixed(3)}) -> viewport (${newX},${newY}) in ${viewport.w}x${viewport.h}`);
        x = newX;
        y = newY;
      }
    } catch (e) {
      console.log('[click_at] Could not get viewport, falling back to DPR scaling');
      // Fallback to DPR scaling
      try {
        const dprResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.devicePixelRatio || 1,
        });
        const dpr = dprResults[0]?.result || 1;
        if (dpr > 1) {
          x = Math.round(x / dpr);
          y = Math.round(y / dpr);
        }
      } catch { /* ignore */ }
    }
  } else {
    // No screenshot dimensions, try DPR scaling as fallback
    try {
      const dprResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.devicePixelRatio || 1,
      });
      const dpr = dprResults[0]?.result || 1;
      if (dpr > 1) {
        console.log(`[click_at] DPR fallback: (${x},${y}) / ${dpr} -> (${Math.round(x/dpr)},${Math.round(y/dpr)})`);
        x = Math.round(x / dpr);
        y = Math.round(y / dpr);
      }
    } catch (e) {
      console.log('[click_at] Could not get DPR, using raw coordinates');
    }
  }

  const target = { tabId };

  // Use content script for shadow DOM sites (useContentScript=true) or when debugger unavailable
  const useContentScript = params.useContentScript || !chrome.debugger;

  if (useContentScript) {
    console.log('[click_at] Using content script method (shadow DOM compatible)');
    const clickCount = params.count || 1;
    const clickDelay = params.delay || 0;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (clickX: number, clickY: number, count: number, delay: number) => {
          const element = document.elementFromPoint(clickX, clickY);
          if (!element) {
            return { clicked: false, error: 'No element at coordinates' };
          }

          const startTime = performance.now();
          let clicked = 0;

          const doClick = () => {
            // Dispatch full mouse event sequence
            const mousedown = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: clickX,
              clientY: clickY,
              view: window,
              button: 0,
            });
            const mouseup = new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              clientX: clickX,
              clientY: clickY,
              view: window,
              button: 0,
            });
            const click = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: clickX,
              clientY: clickY,
              view: window,
              button: 0,
            });

            element.dispatchEvent(mousedown);
            element.dispatchEvent(mouseup);
            element.dispatchEvent(click);

            // Also try native click
            if (element instanceof HTMLElement) {
              element.click();
            }
            clicked++;
          };

          // Rapid clicking
          if (delay > 0) {
            // With delay - use sync loop with blocking
            for (let i = 0; i < count; i++) {
              doClick();
              if (i < count - 1) {
                const end = performance.now() + delay;
                while (performance.now() < end) { /* busy wait */ }
              }
            }
          } else {
            // No delay - as fast as possible
            for (let i = 0; i < count; i++) {
              doClick();
            }
          }

          const elapsed = performance.now() - startTime;
          return {
            clicked: true,
            count: clicked,
            element: element.tagName,
            elapsedMs: elapsed,
          };
        },
        args: [x, y, clickCount, clickDelay],
      });

      const result = results[0]?.result as { clicked: boolean; count?: number; element?: string; elapsedMs?: number; error?: string } | undefined;
      if (result?.clicked) {
        return {
          success: true,
          result: { ...result, x, y, method: 'content-script' },
        };
      }
      return { success: false, error: result?.error || 'Content script click failed' };
    } catch (err) {
      return { success: false, error: `Content script click failed: ${err}` };
    }
  }

  // Support rapid clicking with count parameter
  const clickCount = params.count || 1;
  const clickDelay = params.delay || 0; // ms between clicks
  const startTime = performance.now();

  try {
    // Attach debugger to tab
    await chrome.debugger.attach(target, '1.3');
    console.log('[click_at] Debugger attached to tab', tabId);

    // Mouse move to coordinates
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });

    // Small delay for hover effect
    await new Promise(resolve => setTimeout(resolve, 50));

    // Perform clicks (supports rapid clicking)
    for (let i = 0; i < clickCount; i++) {
      // Mouse down
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: params.button || 'left',
        clickCount: params.doubleClick ? 2 : 1,
      });

      // Mouse up
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: params.button || 'left',
        clickCount: params.doubleClick ? 2 : 1,
      });

      // Delay between clicks if specified
      if (clickDelay > 0 && i < clickCount - 1) {
        await new Promise(resolve => setTimeout(resolve, clickDelay));
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[click_at] Successfully clicked ${clickCount}x at (${x},${y}) in ${elapsed.toFixed(0)}ms`);

    return {
      success: true,
      result: {
        clicked: true,
        count: clickCount,
        x,
        y,
        elapsedMs: elapsed,
        method: 'cdp',
        note: clickCount > 1 ? `Rapid clicked ${clickCount}x via CDP` : 'Clicked via Chrome DevTools Protocol at coordinates',
      },
    };
  } catch (error) {
    console.error('[click_at] Error:', error);
    return {
      success: false,
      error: `click_at failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Always detach debugger
    try {
      await chrome.debugger.detach(target);
      console.log('[click_at] Debugger detached');
    } catch {
      // Ignore detach errors
    }
  }
}

/**
 * Type at specific coordinates - click first, then type
 * Used for canvas-based input fields that vision AI located
 *
 * For shadow DOM sites (TikTok, etc.), use useContentScript=true to bypass CDP
 * which doesn't work on shadow DOM elements
 */
async function typeAtCoordinates(params: BrowserActionParams): Promise<CommandResult> {
  let x = params.x;
  let y = params.y;
  const text = params.text;
  const useContentScript = params.useContentScript || false;

  if (typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, error: 'type_at requires x and y coordinate parameters' };
  }
  if (!text) {
    return { success: false, error: 'type_at requires text parameter' };
  }

  // Get target tab
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
    return { success: false, error: 'No tab for type_at' };
  }

  // Resolution-agnostic coordinate conversion (same as click_at)
  const screenshotWidth = params.screenshotWidth;
  const screenshotHeight = params.screenshotHeight;

  if (screenshotWidth && screenshotHeight) {
    try {
      const viewportResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ w: window.innerWidth, h: window.innerHeight }),
      });
      const viewport = viewportResults[0]?.result;
      if (viewport) {
        const xRatio = x / screenshotWidth;
        const yRatio = y / screenshotHeight;
        const newX = Math.round(xRatio * viewport.w);
        const newY = Math.round(yRatio * viewport.h);
        console.log(`[type_at] Resolution agnostic: (${x},${y}) in ${screenshotWidth}x${screenshotHeight} -> (${newX},${newY}) in ${viewport.w}x${viewport.h}`);
        x = newX;
        y = newY;
      }
    } catch (e) {
      console.log('[type_at] Could not get viewport for coordinate conversion');
    }
  }

  // For shadow DOM sites OR if debugger not available, use content script
  // Content script uses execCommand which works on contenteditable in shadow DOM
  if (useContentScript || !chrome.debugger) {
    console.log('[type_at] Using content script method (shadow DOM compatible)');
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (clickX: number, clickY: number, inputText: string) => {
          // Click at coordinates first
          const element = document.elementFromPoint(clickX, clickY) as HTMLElement;
          if (!element) {
            return { typed: false, error: 'No element at coordinates' };
          }

          // Focus the element
          element.click();
          element.focus();

          // Small delay
          return new Promise(resolve => {
            setTimeout(() => {
              // Try to type - check if it's an input/textarea
              const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
              if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                activeEl.value = inputText;
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                resolve({ typed: true, element: activeEl.tagName, method: 'value' });
              } else if (activeEl && activeEl.isContentEditable) {
                // Use execCommand for contenteditable (works on shadow DOM)
                // First place cursor at end, then insert text
                const selection = window.getSelection();
                if (selection) {
                  selection.selectAllChildren(activeEl);
                  selection.collapseToEnd();
                }
                const inserted = document.execCommand('insertText', false, inputText);
                activeEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: inputText, inputType: 'insertText' }));
                resolve({ typed: inserted, element: 'contenteditable', method: 'execCommand', text: inputText });
              } else {
                // Fallback: find contenteditable in ancestors
                let editableEl: HTMLElement | null = element;
                while (editableEl && !editableEl.isContentEditable) {
                  editableEl = editableEl.parentElement;
                }
                if (editableEl && editableEl.isContentEditable) {
                  editableEl.focus();
                  const selection = window.getSelection();
                  if (selection) {
                    selection.selectAllChildren(editableEl);
                    selection.collapseToEnd();
                  }
                  const inserted = document.execCommand('insertText', false, inputText);
                  editableEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: inputText, inputType: 'insertText' }));
                  resolve({ typed: inserted, element: 'contenteditable-ancestor', method: 'execCommand', text: inputText });
                } else {
                  // Last resort: try execCommand on document anyway
                  const inserted = document.execCommand('insertText', false, inputText);
                  if (inserted) {
                    resolve({ typed: true, element: 'document', method: 'execCommand-fallback', text: inputText });
                  } else {
                    resolve({ typed: false, element: element.tagName, method: 'failed', error: 'No editable element found' });
                  }
                }
              }
            }, 100);
          });
        },
        args: [x, y, text],
      });
      const result = results[0]?.result as { typed: boolean; element?: string; method?: string; error?: string; text?: string } | undefined;
      if (result?.typed) {
        return { success: true, result: { ...result, x, y, viewportCoords: true } };
      }
      return { success: false, error: result?.error || 'Content script type_at failed' };
    } catch (err) {
      return { success: false, error: `Content script type_at failed: ${err}` };
    }
  }

  // CDP path (for simple sites without shadow DOM)
  // First click to focus the element
  const clickResult = await clickAtCoordinates({ ...params, x, y, doubleClick: false });
  if (!clickResult.success) {
    return clickResult;
  }

  // Small delay for focus
  await new Promise(resolve => setTimeout(resolve, 100));

  // Then type using type_raw
  return await typeRawViaDebugger({ ...params });
}

/**
 * Execute form fill action
 */
async function executeFillForm(params: BrowserActionParams): Promise<CommandResult> {
  if (!params.fields || params.fields.length === 0) {
    return { success: false, error: 'fill action requires fields parameter' };
  }

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
    return { success: false, error: 'No tab for evaluate' };
  }

  try {
    // Use content script to evaluate - it can inject script into page context
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EVALUATE',
      payload: { fn: params.fn },
    });

    if (response?.success) {
      return { success: true, result: response.result };
    } else {
      return { success: false, error: response?.error || 'Evaluate failed' };
    }
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
  // Default: grayscale + compressed JPEG for vision (smaller file, accurate coords)
  // Optional: fullColor=true for when agent needs color context
  const fullColor = params.fullColor || false;
  const format = fullColor ? (params.format || 'png') : 'jpeg';
  const quality = params.quality || (fullColor ? 90 : 50); // Lower quality for vision

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
  let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: format as 'png' | 'jpeg',
    quality: format === 'jpeg' ? quality : undefined,
  });

  // Get screenshot dimensions from the PNG/JPEG itself
  // This is resolution-agnostic - no page access needed
  let screenshotWidth = 0;
  let screenshotHeight = 0;
  try {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);

    if (format === 'png') {
      // PNG: dimensions at bytes 16-23 (IHDR chunk)
      // Width: bytes 16-19, Height: bytes 20-23 (big-endian)
      screenshotWidth = (binary.charCodeAt(16) << 24) | (binary.charCodeAt(17) << 16) |
                        (binary.charCodeAt(18) << 8) | binary.charCodeAt(19);
      screenshotHeight = (binary.charCodeAt(20) << 24) | (binary.charCodeAt(21) << 16) |
                         (binary.charCodeAt(22) << 8) | binary.charCodeAt(23);
    } else {
      // JPEG: need to parse markers - simplified approach
      // Look for SOF0 marker (0xFF 0xC0) which contains dimensions
      for (let i = 0; i < binary.length - 10; i++) {
        if (binary.charCodeAt(i) === 0xFF && binary.charCodeAt(i + 1) === 0xC0) {
          screenshotHeight = (binary.charCodeAt(i + 5) << 8) | binary.charCodeAt(i + 6);
          screenshotWidth = (binary.charCodeAt(i + 7) << 8) | binary.charCodeAt(i + 8);
          break;
        }
      }
    }
    console.log(`[screenshot] Decoded dimensions: ${screenshotWidth}x${screenshotHeight}`);
  } catch (e) {
    console.log('[screenshot] Could not decode dimensions:', e);
  }

  // Convert to grayscale for vision (default) - reduces file size significantly
  // while preserving full resolution for accurate coordinates
  if (!fullColor && screenshotWidth > 0 && screenshotHeight > 0) {
    try {
      // Use OffscreenCanvas to convert to grayscale
      const offscreen = new OffscreenCanvas(screenshotWidth, screenshotHeight);
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        // Load image
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        // Draw and convert to grayscale
        ctx.drawImage(imageBitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, screenshotWidth, screenshotHeight);
        const data = imageData.data;

        // Convert to grayscale using luminance formula
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          data[i] = gray;     // R
          data[i + 1] = gray; // G
          data[i + 2] = gray; // B
          // Alpha stays the same
        }

        ctx.putImageData(imageData, 0, 0);

        // Convert back to JPEG with compression
        const grayBlob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
        const reader = new FileReader();
        const grayDataUrl = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(grayBlob);
        });

        dataUrl = grayDataUrl;
        console.log(`[screenshot] Converted to grayscale JPEG (quality: ${quality}%)`);
      }
    } catch (e) {
      console.log('[screenshot] Grayscale conversion failed, using original:', e);
    }
  }

  return {
    success: true,
    result: {
      dataUrl,
      format: fullColor ? format : 'jpeg',
      grayscale: !fullColor,
      quality,
      tabId,
      url: tab.url,
      title: tab.title,
      // Include dimensions for resolution-agnostic coordinate conversion
      ...(screenshotWidth && screenshotHeight ? { screenshotWidth, screenshotHeight } : {}),
    },
  };
}

async function getSnapshot(params: BrowserActionParams): Promise<CommandResult> {
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
