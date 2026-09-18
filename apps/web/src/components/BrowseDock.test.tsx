// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { BrowseDock, CARD_TWO_ROW_HEIGHT } from './BrowseDock.js';

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
  onCollapsedChange: vi.fn(),
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

it('collapsed shows only the Focus area and an expand button', () => {
  const onCollapsedChange = vi.fn();
  render(createElement(BrowseDock, {
    ...baseProps, narrow: false, collapsed: true, onCollapsedChange, narrowView: 'browse',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  expect(screen.queryByText('browse-content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Expand browse panel'));
  expect(onCollapsedChange).toHaveBeenCalledWith(false);
});

it('renders both regions with a collapse button when docked and expanded', () => {
  const onCollapsedChange = vi.fn();
  render(createElement(BrowseDock, {
    ...baseProps, narrow: false, collapsed: false, onCollapsedChange, narrowView: 'browse',
    browse: createElement('div', null, 'browse-content'),
    children: createElement('div', null, 'focus-content'),
  }));
  expect(screen.getByText('browse-content')).toBeInTheDocument();
  expect(screen.getByText('focus-content')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Collapse browse panel'));
  expect(onCollapsedChange).toHaveBeenCalledWith(true);
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
