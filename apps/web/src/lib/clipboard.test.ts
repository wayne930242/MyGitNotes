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
