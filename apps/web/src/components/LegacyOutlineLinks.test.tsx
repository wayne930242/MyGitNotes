// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { planLegacyOutlineImport } from '@mygitnotes/core/outline-import';
import { LiveMarkdownEditor } from './LiveMarkdownEditor.js';
import { WorkspaceLinks } from './WorkspaceLinks.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(['https://example.com/?x=1&v=2#part&two', 'https://example.com/?literal=&amp;v=2&#38;value=3#&amp;'])('activates an imported URL with exact query and fragment semantics: %s', url => {
  const owner = { id: 'n', root: 'notes/n', title: 'N' };
  const plan = planLegacyOutlineImport({ version: 1, notebooks: [{ notebookId: 'n', groups: [], bookmarks: [{ id: 'url', label: '1. [Reference]', groupId: null, target: { kind: 'url', url } }] }] }, owner, [owner], { repository: 'r', notebookId: 'n', path: 'notes/n/import.outline.md', title: 'Imported', selectedIds: ['url'] });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <WorkspaceLinks notebooks={[owner]} folders={[]} onOpenNote={() => {}}>
          <LiveMarkdownEditor readOnly={false} content={plan.markdown!} notePath={plan.path} notebookId='n' onChange={() => {}} ariaLabel='Outline' />
        </WorkspaceLinks>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const anchor = container.querySelector<HTMLAnchorElement>('a.live-md-external-link')!;
  expect(anchor).not.toBeNull();
  expect(anchor.href).toBe(url);
  expect(container.querySelector('[data-workspace-link]')?.textContent).toBe('1. [Reference]');
  fireEvent.click(anchor);
  expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  expect(new URL(open.mock.calls[0][0] as string).searchParams.toString()).toBe(new URL(url).searchParams.toString());
});
it('decodes inline and reference destinations once, leaves autolinks literal, and rejects encoded unsafe schemes', () => {
  const content = '[inline](https://example.com/?a=1&#38;b=2)\n\n[reference][r]\n\n[r]: https://example.com/?literal=&amp;amp;\n\n<https://example.com/?literal=&amp;>\n\n[unsafe](jav&#x61;script:alert)';
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LiveMarkdownEditor readOnly={false} content={content} notePath='notes/n/ordinary.md' notebookId='n' onChange={() => {}} ariaLabel='Note' />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect([...container.querySelectorAll<HTMLAnchorElement>('a.live-md-external-link')].map(anchor => anchor.href)).toEqual(['https://example.com/?a=1&b=2', 'https://example.com/?literal=&amp;', 'https://example.com/?literal=&amp;']);
});
