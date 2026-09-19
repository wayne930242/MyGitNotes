import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentHookInstance: any = null;

vi.mock('react', () => ({ useState: (init: any) => currentHookInstance.useState(init), useRef: (init: any) => currentHookInstance.useRef(init), useCallback: (fn: any) => currentHookInstance.useCallback(fn), useEffect: (fn: any, deps?: any[]) => currentHookInstance.useEffect(fn, deps) }));

import { LONG_PRESS_MS, MOVE_CANCEL_X_PX, MOVE_CANCEL_Y_PX, shouldCancelLongPress, useLongPress } from './use-long-press.js';

interface HookRunner {
  result: ReturnType<typeof useLongPress>;
  onLongPress: ReturnType<typeof vi.fn>;
  dispatchScroll: () => void;
  unmount: () => void;
}

function setupHook(enabled = true, onLongPress = vi.fn()): HookRunner {
  const stateMap = new Map<number, any>();
  const refMap = new Map<number, { current: any; }>();
  const cleanups: Array<() => void> = [];
  const scrollListeners: Function[] = [];
  let currentResult!: ReturnType<typeof useLongPress>;
  const prevDeps = new Map<number, any[]>();

  const fakeWindow = {
    addEventListener: (type: string, fn: Function) => {
      if (type === 'scroll') scrollListeners.push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (type === 'scroll') {
        const idx = scrollListeners.indexOf(fn);
        if (idx >= 0) scrollListeners.splice(idx, 1);
      }
    },
  };
  vi.stubGlobal('window', fakeWindow);

  function render() {
    let stateIdx = 0;
    let refIdx = 0;
    let effectIdx = 0;

    currentHookInstance = {
      useState: (initial: any) => {
        const idx = stateIdx++;
        if (!stateMap.has(idx)) {
          stateMap.set(idx, typeof initial === 'function' ? initial() : initial);
        }
        const setState = (next: any) => {
          const prev = stateMap.get(idx);
          const val = typeof next === 'function' ? next(prev) : next;
          if (val !== prev) {
            stateMap.set(idx, val);
            render();
          }
        };
        return [stateMap.get(idx), setState];
      },
      useRef: (initial: any) => {
        const idx = refIdx++;
        if (!refMap.has(idx)) {
          refMap.set(idx, { current: initial });
        }
        return refMap.get(idx)!;
      },
      useCallback: (fn: any) => fn,
      useEffect: (fn: any, deps?: any[]) => {
        const idx = effectIdx++;
        const lastDeps = prevDeps.get(idx);
        const hasChanged = !lastDeps || !deps || deps.some((dep, i) => dep !== lastDeps[i]);
        if (hasChanged) {
          prevDeps.set(idx, deps ? [...deps] : []);
          if (cleanups[idx]) cleanups[idx]();
          const cleanup = fn();
          if (typeof cleanup === 'function') {
            cleanups[idx] = cleanup;
          }
        }
      },
    };

    currentResult = useLongPress(onLongPress, enabled);
  }

  render();

  return {
    get result() {
      return currentResult;
    },
    onLongPress,
    dispatchScroll: () => {
      for (const listener of [...scrollListeners]) listener();
    },
    unmount: () => {
      for (const cleanup of cleanups) cleanup?.();
    },
  };
}

function makeTouchEvent(touches: Array<{ clientX: number; clientY: number; }>) {
  return { touches } as unknown as import('react').TouchEvent;
}

function makeMouseEvent() {
  return { defaultPrevented: false, preventDefault: vi.fn() } as unknown as import('react').MouseEvent;
}

describe('use-long-press geometry', () => {
  it('defines 500ms long press duration', () => {
    expect(LONG_PRESS_MS).toBe(500);
  });

  it('keeps long-press active within small finger tremors', () => {
    const start = { x: 100, y: 100 };
    expect(shouldCancelLongPress(start, { x: 105, y: 104 })).toBe(false);
    expect(shouldCancelLongPress(start, { x: 100, y: 100 })).toBe(false);
  });

  it('cancels long-press when finger moves horizontally beyond threshold', () => {
    const start = { x: 100, y: 100 };
    expect(shouldCancelLongPress(start, { x: 100 + MOVE_CANCEL_X_PX + 1, y: 100 })).toBe(true);
    expect(shouldCancelLongPress(start, { x: 100 - MOVE_CANCEL_X_PX - 1, y: 100 })).toBe(true);
  });

  it('cancels long-press when finger scrolls vertically beyond drawer scroll threshold', () => {
    const start = { x: 100, y: 100 };
    expect(shouldCancelLongPress(start, { x: 100, y: 100 + MOVE_CANCEL_Y_PX + 1 })).toBe(true);
    expect(shouldCancelLongPress(start, { x: 100, y: 100 - MOVE_CANCEL_Y_PX - 1 })).toBe(true);
  });
});

describe('useLongPress hook behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('triggers onLongPress and suppresses the synthetic click after 500ms touch', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // End of touch
    result.onTouchEnd();

    // Synthetic click arrives right after long-press touch end
    const clickHandler = vi.fn();
    const clickEvent = makeMouseEvent();
    result.onClick(clickHandler)(clickEvent);

    expect(clickEvent.preventDefault).toHaveBeenCalled();
    expect(clickHandler).not.toHaveBeenCalled();

    // Next normal click should pass through normally
    const nextHandler = vi.fn();
    const nextEvent = makeMouseEvent();
    result.onClick(nextHandler)(nextEvent);
    expect(nextHandler).toHaveBeenCalledWith(nextEvent);
  });

  it('does not trigger onLongPress on short tap and allows plain click', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(250);
    result.onTouchEnd();

    vi.advanceTimersByTime(300);
    expect(onLongPress).not.toHaveBeenCalled();

    const clickHandler = vi.fn();
    const clickEvent = makeMouseEvent();
    result.onClick(clickHandler)(clickEvent);
    expect(clickHandler).toHaveBeenCalledWith(clickEvent);
    expect(clickEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels timer when movement exceeds cancel threshold (3.4)', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(200);

    // Slight movement within tolerance
    result.onTouchMove(makeTouchEvent([{ clientX: 55, clientY: 54 }]));
    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();

    // Exceed tolerance
    result.onTouchMove(makeTouchEvent([{ clientX: 50 + MOVE_CANCEL_X_PX + 2, clientY: 50 }]));
    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels timer on multi-touch at touch start (3.3)', () => {
    const { result, onLongPress } = setupHook();

    // Two fingers simultaneously on touch start
    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }, { clientX: 80, clientY: 80 }]));
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels timer when second finger touches down during long-press (3.3)', () => {
    const { result, onLongPress } = setupHook();

    // First finger down
    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(200);

    // Second finger down (pinch-zoom start)
    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }, { clientX: 90, clientY: 90 }]));
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels timer when second finger detected in touch move (3.3)', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(200);

    // Touch move with 2 touches
    result.onTouchMove(makeTouchEvent([{ clientX: 50, clientY: 50 }, { clientX: 90, clientY: 90 }]));
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('resets suppressClick after 400ms timeout if synthetic click never arrives (3.2)', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // Finger moves off or browser does not emit synthetic click
    result.onTouchEnd();

    // After 400ms timeout expires, suppressClick must automatically clear
    vi.advanceTimersByTime(450);

    const clickHandler = vi.fn();
    const clickEvent = makeMouseEvent();
    result.onClick(clickHandler)(clickEvent);

    // The subsequent click must NOT be swallowed
    expect(clickHandler).toHaveBeenCalledWith(clickEvent);
  });

  it('clears lingering suppressClick on subsequent onTouchStart (3.2)', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    result.onTouchEnd();

    // User immediately taps again before 400ms timeout
    vi.advanceTimersByTime(100);
    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    result.onTouchEnd();

    const clickHandler = vi.fn();
    const clickEvent = makeMouseEvent();
    result.onClick(clickHandler)(clickEvent);
    expect(clickHandler).toHaveBeenCalledWith(clickEvent);
  });

  it('cancels long press and clears suppressClick on touch cancel (3.2)', () => {
    const { result, onLongPress } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(300);
    result.onTouchCancel();

    vi.advanceTimersByTime(300);
    expect(onLongPress).not.toHaveBeenCalled();

    const clickHandler = vi.fn();
    const clickEvent = makeMouseEvent();
    result.onClick(clickHandler)(clickEvent);
    expect(clickHandler).toHaveBeenCalledWith(clickEvent);
  });

  it('cancels long press on scroll event', () => {
    const { result, onLongPress, dispatchScroll } = setupHook();

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(200);

    dispatchScroll();
    vi.advanceTimersByTime(400);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const { result, onLongPress } = setupHook(false);

    result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('prevents context menu while pressing or when click is suppressed', () => {
    const runner = setupHook();

    runner.result.onTouchStart(makeTouchEvent([{ clientX: 50, clientY: 50 }]));
    const contextMenuEvent = makeMouseEvent();
    runner.result.onContextMenu(contextMenuEvent);
    expect(contextMenuEvent.preventDefault).toHaveBeenCalled();
  });
});
