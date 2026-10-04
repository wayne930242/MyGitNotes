// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { captureBookmarkSelection } from '@mygitnotes/core/bookmark-anchor';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor.js';
afterEach(cleanup);
function rawEditor(content: string, format: string) {
  const ref = createRef<MarkdownEditorHandle>(), onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MarkdownEditor ref={ref} content={content} path={`notes/a.${format}`} mode='raw' readOnly={false} onChange={onChange} ariaLabel='Source' toolbarSlot={null} />
    </QueryClientProvider>,
  );
  return { ref, onChange, textarea: screen.getByLabelText<HTMLTextAreaElement>('Source') };
}
it.each(['md', 'txt'])('raw %s selection maps normalized textarea offsets to the original CRLF body', format => {
  const content = '# H\r\n\r\nParagraph';
  const { ref, onChange, textarea } = rawEditor(content, format);
  expect(textarea.value).toBe('# H\n\nParagraph');
  textarea.setSelectionRange(5, 14);
  const range = ref.current!.getSelection()!;
  expect(range).toEqual({ from: 7, to: 16 });
  expect(captureBookmarkSelection(content, range, format).exact).toBe('Paragraph');
  expect(onChange).not.toHaveBeenCalled();
});
it.each(['\r\n', '\n'])('raw reveal maps original %j source offsets back into the real textarea', newline => {
  const content = `# H${newline}${newline}Paragraph`;
  const { ref, onChange, textarea } = rawEditor(content, 'md');
  act(() => ref.current!.revealRange(content.indexOf('Paragraph'), content.length, true));
  expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('Paragraph');
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([5, 14]);
  expect(document.activeElement).toBe(textarea);
  expect(onChange).not.toHaveBeenCalled();
});
