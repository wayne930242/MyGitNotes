import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({ useEffect: (effect: () => unknown) => effect() }));
import { useAltWheelHorizontalScroll } from './use-alt-wheel-horizontal-scroll.js';

afterEach(() => vi.unstubAllGlobals());

function setup(nested = true) {
  let listener: (event: WheelEvent) => void = () => {};
  const scroller = { scrollLeft: 0, clientWidth: 300 };
  class Child {
    closest() {
      return scroller;
    }
  }
  vi.stubGlobal('Element', Child);
  vi.stubGlobal('WheelEvent', { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
  const host = {
    contains: () => nested,
    addEventListener: (_: string, fn: typeof listener) => {
      listener = fn;
    },
    removeEventListener() {},
  };
  useAltWheelHorizontalScroll({ current: host as unknown as HTMLElement }, { current: scroller as unknown as HTMLElement }, nested ? '.table-scroll' : undefined);
  const event = { target: new Child(), altKey: true, ctrlKey: false, defaultPrevented: false, deltaX: 0, deltaY: 40, deltaMode: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return { scroller, event, dispatch: () => listener(event as unknown as WheelEvent) };
}

describe('Alt wheel horizontal scrolling', () => {
  it('routes vertical wheel input to the table under the pointer', () => {
    const { scroller, event, dispatch } = setup();
    dispatch();
    expect(scroller.scrollLeft).toBe(40);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it('preserves ordinary vertical scrolling and horizontal trackpad input', () => {
    const { scroller, event, dispatch } = setup();
    event.altKey = false;
    dispatch();
    event.altKey = true;
    event.deltaX = 60;
    dispatch();
    expect(scroller.scrollLeft).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('preserves existing ancestor-scroller behavior and line units', () => {
    const { scroller, event, dispatch } = setup(false);
    event.deltaMode = 1;
    dispatch();
    expect(scroller.scrollLeft).toBe(640);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
  it('leaves events already handled by a nested table alone', () => {
    const { scroller, event, dispatch } = setup(false);
    event.defaultPrevented = true;
    dispatch();
    expect(scroller.scrollLeft).toBe(0);
  });
});
