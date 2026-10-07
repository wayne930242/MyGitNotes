// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useLeaveWarning } from './use-leave-warning.js';

const leave = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

it('asks to confirm leaving only while changes are uncommitted', () => {
  const { rerender, unmount } = renderHook(({ pending }) => useLeaveWarning(pending), { initialProps: { pending: false } });
  expect(leave()).toBe(false);
  rerender({ pending: true });
  expect(leave()).toBe(true);
  rerender({ pending: false });
  expect(leave()).toBe(false);
  rerender({ pending: true });
  unmount();
  expect(leave()).toBe(false);
});
