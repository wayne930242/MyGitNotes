import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard.js';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available and succeeding', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', {});

    const result = await copyToClipboard('mcp-token-xyz');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('mcp-token-xyz');
  });

  it('copies the displayed URL synchronously before a pending clipboard permission request', async () => {
    const writeText = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', {});
    const target = {
      value: 'https://example.com/mcp/test-token',
      readOnly: true,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    } as unknown as HTMLInputElement;
    const execCommand = vi.fn(() => {
      expect(target.readOnly).toBe(false);
      return true;
    });
    vi.stubGlobal('document', { execCommand });

    const result = copyToClipboard(target.value, target);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(writeText).not.toHaveBeenCalled();
    expect(await result).toBe(true);
    expect(target.readOnly).toBe(true);
  });

  it('uses the requested text when the displayed value differs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', {});
    const target = { value: 'old-url', select: vi.fn() } as unknown as HTMLInputElement;
    expect(await copyToClipboard('new-url', target)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('new-url');
    expect(target.select).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when navigator.clipboard throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', {});

    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: () => {
        const el = {
          value: '',
          style: {},
          setAttribute: vi.fn(),
          focus: vi.fn(),
          select: vi.fn(),
          setSelectionRange: vi.fn(),
        };
        return el;
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand,
    });

    const result = await copyToClipboard('mcp-token-xyz');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('mcp-token-xyz');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard is undefined (non-secure context)', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});

    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand,
    });

    const result = await copyToClipboard('http-token-url');
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('temporarily unsets readOnly on targetElement and restores it when copying', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});

    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      execCommand,
    });

    const targetInput = {
      value: 'token-url-to-copy',
      readOnly: true,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    } as unknown as HTMLInputElement;

    const result = await copyToClipboard('token-url-to-copy', targetInput);
    expect(result).toBe(true);
    expect(targetInput.readOnly).toBe(true);
    expect(targetInput.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('configures fallback textarea correctly without readonly and inside viewport', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});

    const execCommand = vi.fn().mockReturnValue(true);
    let createdEl: any = null;
    vi.stubGlobal('document', {
      createElement: () => {
        createdEl = {
          value: '',
          style: {},
          setAttribute: vi.fn(),
          focus: vi.fn(),
          select: vi.fn(),
          setSelectionRange: vi.fn(),
        };
        return createdEl;
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand,
    });

    const result = await copyToClipboard('https://example.com/mcp/123');
    expect(result).toBe(true);
    expect(createdEl).not.toBeNull();
    expect(createdEl.style.position).toBe('fixed');
    expect(createdEl.style.top).toBe('0');
    expect(createdEl.style.left).toBe('0');
    expect(createdEl.style.opacity).toBe('0.01');
    expect(createdEl.style.fontSize).toBe('16px');
    // Ensure 'readonly' was NOT set
    expect(createdEl.setAttribute).not.toHaveBeenCalledWith('readonly', expect.anything());
    expect(createdEl.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(createdEl.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
  });

  it('selects targetElement when all copy methods fail', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});

    const execCommand = vi.fn().mockReturnValue(false);
    vi.stubGlobal('document', {
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand,
    });

    const targetInput = {
      value: 'token-url',
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    } as unknown as HTMLInputElement;

    const result = await copyToClipboard('token-url', targetInput);
    expect(result).toBe(false);
    expect(targetInput.select).toHaveBeenCalled();
  });
});
