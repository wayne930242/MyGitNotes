// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { BrowseDock, BrowseDockToggle, CARD_TWO_ROW_HEIGHT } from './BrowseDock.js';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(cleanup);

const baseProps = {
  placement: 'left' as const,
  size: 280,
  onSizeChange: vi.fn(),
  collapsed: false,
};

it('exports a positive card two-row height threshold', () => {
  expect(CARD_TWO_ROW_HEIGHT).toBeGreaterThan(0);
});

it('renders only the browse content when narrow and narrowView is browse', () => {
  render(createElement(BrowseDock, {
    ...baseProps, narrow: true, narrowView: 'browse',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('browse-content')).toBeInTheDocument();
  expect(screen.queryByText('focus-content')).not.toBeInTheDocument();
});

it('renders only the Focus content when narrow and narrowView is focus', () => {
  render(createElement(BrowseDock, {
    ...baseProps, narrow: true, narrowView: 'focus',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByText('browse-content')).not.toBeInTheDocument();
});

it('collapsed shows only the Focus area, with no control over it', () => {
  render(createElement(BrowseDock, {
    ...baseProps, narrow: false, collapsed: true, narrowView: 'browse',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByText('browse-content')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('renders both regions, with no control over them, when docked and expanded', () => {
  render(createElement(BrowseDock, {
    ...baseProps, narrow: false, collapsed: false, narrowView: 'browse',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('browse-content')).toBeInTheDocument();
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('toggle collapses an expanded dock and reopens a collapsed one', () => {
  const onCollapsedChange = vi.fn();
  const { rerender } = render(createElement(BrowseDockToggle, { placement: 'left', collapsed: false, onCollapsedChange }));
  fireEvent.click(screen.getByLabelText('Collapse browse panel'));
  expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
  rerender(createElement(BrowseDockToggle, { placement: 'left', collapsed: true, onCollapsedChange }));
  fireEvent.click(screen.getByLabelText('Expand browse panel'));
  expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
});

it('passes the measured panel height to a function browse prop', () => {
  const browse = vi.fn((height: number) => createElement('div', null, `h:${height}`));
  render(createElement(BrowseDock, {
    ...baseProps, narrow: false, collapsed: false, narrowView: 'browse',
    browse,
    children: createElement('div', null, 'focus-content'),
  }));
  expect(browse).toHaveBeenCalledWith(expect.any(Number));
});
