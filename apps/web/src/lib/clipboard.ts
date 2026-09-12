/**
 * Robust clipboard copy helper with fallback for non-secure contexts (HTTP)
 * and environments where navigator.clipboard is unavailable or restricted.
 */
export async function copyToClipboard(
  text: string,
  targetElement?: HTMLInputElement | HTMLTextAreaElement | null
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Try Modern Clipboard API first if available
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Modern Clipboard API failed (e.g. document not focused, non-secure context, permission denied, or Safari restriction)
      // Fall through to execCommand
    }
  }

  // 2. If targetElement is provided and attached, try selecting it directly.
  // In WebKit/Safari, document.execCommand('copy') fails if the input has readOnly=true.
  // We temporarily toggle readOnly if present.
  if (targetElement && typeof targetElement.select === 'function') {
    const wasReadOnly = targetElement.readOnly;
    try {
      if (wasReadOnly) {
        targetElement.readOnly = false;
      }
      targetElement.focus({ preventScroll: true });
      targetElement.select();
      if (typeof targetElement.setSelectionRange === 'function') {
        targetElement.setSelectionRange(0, targetElement.value.length);
      }
      const success = document.execCommand('copy');
      if (wasReadOnly) {
        targetElement.readOnly = true;
      }
      if (success) {
        return true;
      }
    } catch {
      if (wasReadOnly) {
        targetElement.readOnly = true;
      }
      // Fall through to temporary textarea
    }
  }

  // 3. Fallback using a temporary textarea + document.execCommand('copy')
  // Cross-browser & Mobile compatibility rules:
  // - Do NOT set 'readonly' (Safari ignores execCommand('copy') on readonly elements).
  // - Do NOT place at -9999px (WebKit and modern Chromium may treat elements outside viewport bounds as unrendered).
  // - Use position: fixed at top/left 0 with minimal size and opacity 0.01 (so it's rendered in layout tree).
  // - Use fontSize: 16px to prevent iOS auto-zooming.
  // - Use aria-hidden and tabindex -1 for accessibility.
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0.01';
    textArea.style.pointerEvents = 'none';
    textArea.style.fontSize = '16px';
    textArea.setAttribute('aria-hidden', 'true');
    textArea.setAttribute('tabindex', '-1');

    document.body.appendChild(textArea);
    textArea.focus({ preventScroll: true });
    textArea.select();
    if (typeof textArea.setSelectionRange === 'function') {
      textArea.setSelectionRange(0, text.length);
    }

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) return true;
  } catch {
    // execCommand failed
  }

  // 4. Final attempt: if target element exists, ensure it is selected so the user can manually copy
  if (targetElement && typeof targetElement.select === 'function') {
    try {
      targetElement.focus({ preventScroll: true });
      targetElement.select();
    } catch {
      // Ignore
    }
  }

  return false;
}
