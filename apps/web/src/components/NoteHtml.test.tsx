// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { stop, hydrate } = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, hydrate: vi.fn(() => stop) };
});
vi.mock('../lib/mermaid.js', () => ({ hydrateMermaid: hydrate }));
vi.mock('../lib/i18n/index.js', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { NoteHtml } from './NoteHtml.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('draws the diagrams in the mounted HTML and again when the HTML changes', () => {
  const html = '<div class="note-mermaid"><pre>graph LR</pre></div>';
  const { container, rerender, unmount } = render(<NoteHtml className='prose-custom' html={html} />);
  expect(hydrate).toHaveBeenCalledTimes(1);
  expect(hydrate).toHaveBeenLastCalledWith(container.querySelector('[data-markdown-view]'), { errorLabel: 'mermaid.error' });
  rerender(<NoteHtml className='prose-custom' html={html + '<p>more</p>'} />);
  expect(hydrate).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
  unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});
