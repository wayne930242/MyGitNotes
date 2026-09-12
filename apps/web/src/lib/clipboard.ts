/**
 * Robust clipboard copy helper with fallback for non-secure contexts (HTTP)
 * and environments where navigator.clipboard is unavailable or restricted.
 */
export async function copyToClipboard(text: string, targetElement?: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Try Modern Clipboard API first if available
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Modern Clipboard API failed (e.g. non-secure context or permission denied), fallback to execCommand
    }
  }

  // 2. If targetElement is provided and attached, try selecting it directly
  if (targetElement && typeof targetElement.select === 'function') {
    try {
      targetElement.focus();
      targetElement.select();
      if (typeof targetElement.setSelectionRange === 'function') {
        targetElement.setSelectionRange(0, targetElement.value.length);
      }
      if (document.execCommand('copy')) {
        return true;
      }
    } catch {
      // Fall through to temporary textarea
    }
  }

  // 3. Fallback using a temporary textarea + document.execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.setAttribute('readonly', '');
    textArea.setAttribute('aria-hidden', 'true');

    document.body.appendChild(textArea);
    textArea.focus();
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

  // 4. Final attempt: if target element exists, ensure it is selected so the user can manually press Ctrl+C / Cmd+C
  if (targetElement && typeof targetElement.select === 'function') {
    try {
      targetElement.focus();
      targetElement.select();
    } catch {
      // Ignore
    }
  }

  return false;
}
