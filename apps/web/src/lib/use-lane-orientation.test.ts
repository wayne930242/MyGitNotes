// @vitest-environment jsdom
import { createElement, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANE_VERTICAL_BELOW, type LaneOrientation, laneOrientation, useLaneOrientation } from './use-lane-orientation.js';

describe('laneOrientation', () => {
  it('lists cards top to bottom under 560px and in a strip from 560px', () => {
    expect(LANE_VERTICAL_BELOW).toBe(560);
    expect(laneOrientation(0)).toBe('vertical');
    expect(laneOrientation(389)).toBe('vertical');
    expect(laneOrientation(559)).toBe('vertical');
    expect(laneOrientation(559.5)).toBe('vertical');
    expect(laneOrientation(560)).toBe('horizontal');
    expect(laneOrientation(1440)).toBe('horizontal');
  });
});

describe('useLaneOrientation', () => {
  let observers: { callback: ResizeObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn>; }[];
  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        record: (typeof observers)[number];
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, disconnect: this.disconnect };
          observers.push(this.record);
        }
        observe(target: Element) {
          this.record.target = target;
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  let seen: LaneOrientation[];
  function Lane() {
    const host = useRef<HTMLElement>(null);
    seen.push(useLaneOrientation(host));
    /* eslint-disable react/refs -- The host ref is attached to the element the hook measures from, as CompilationLane does. */
    return createElement('section', { ref: host });
    /* eslint-enable react/refs */
  }
  const mount = (width: string | null) => {
    seen = [];
    return render(width === null ? createElement(Lane) : createElement('div', { className: 'compilation-view', style: { width } }, createElement(Lane)));
  };
  const resize = (width: number) => act(() => observers[0].callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));

  it('measures the compilation view the lane sits in on mount', () => {
    mount('500px');
    expect(seen.at(-1)).toBe('vertical');
    cleanup();
    mount('560px');
    expect(seen.at(-1)).toBe('horizontal');
  });

  it('follows the compilation view across the threshold and not the viewport', () => {
    const { container } = mount('1200px');
    expect(seen.at(-1)).toBe('horizontal');
    expect(observers[0].target).toBe(container.querySelector('.compilation-view'));
    resize(559);
    expect(seen.at(-1)).toBe('vertical');
    resize(560);
    expect(seen.at(-1)).toBe('horizontal');
  });

  it('stops observing on unmount', () => {
    const { unmount } = mount('500px');
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('keeps a lane outside any compilation view horizontal', () => {
    mount(null);
    expect(seen.at(-1)).toBe('horizontal');
    expect(observers).toHaveLength(0);
  });
});
