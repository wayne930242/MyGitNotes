// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { getLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditorModeSwitch: () => null, MarkdownEditor: forwardRef<unknown, { content: string; onChange: (content: string) => void; }>(({ content, onChange }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })) }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha', updated: 't0' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'pane', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

it('leaves no recovery draft once an autosave succeeds, even while the refreshed note arrives later', async () => {
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...note, content, metadata: { ...metadata, updated: `t${onSave.mock.calls.length}` } }));
  const view = render(editor({ onSave }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  expect(getLocalDraft('src:main', note.path)?.content).toBe('# Alpha\nMore.');

  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  // The saved note reaches the editor after its notes refetch, as `invalidateNotes` does.
  const saved = await onSave.mock.results[0].value;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  view.rerender(editor({ onSave, note: saved }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });

  expect(getLocalDraft('src:main', note.path)).toBeNull();
  view.unmount();
  render(editor({ onSave, note: saved }));
  expect(screen.queryByText(/recover|unsaved draft/i)).toBeNull();
});

it('keeps a recovery draft for edits that were not saved', async () => {
  const onSave = vi.fn(async () => {
    throw new Error('disk full');
  });
  const view = render(editor({ onSave }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nUnsaved.' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  view.unmount();
  expect(getLocalDraft('src:main', note.path)?.content).toBe('# Alpha\nUnsaved.');
});

it('does not report its own autosave as an external change on the next remote check', async () => {
  let diskNote: NoteItem = note;
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => {
    diskNote = { ...note, content, metadata: { ...metadata, updated: `t${onSave.mock.calls.length}` } };
    return diskNote;
  });
  const onReadRemote = vi.fn(async () => diskNote);
  render(editor({ onSave, onReadRemote }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });
  expect(onSave).toHaveBeenCalledTimes(1);

  // Past the remote-check throttle, so the interval fires again and re-reads the note.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(onReadRemote.mock.calls.length).toBeGreaterThan(1);
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nMore.');
});

it('does not let a concurrent remote check read back its own in-flight autosave as an external change', async () => {
  let diskNote: NoteItem = note;
  let resolveSave: (() => void) | null = null;
  const onSave = vi.fn(({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }): Promise<NoteItem> => {
    diskNote = { ...note, content, metadata: { ...metadata, updated: 't1' } };
    return new Promise(resolve => {
      resolveSave = () => resolve(diskNote);
    });
  });
  const onReadRemote = vi.fn(async () => diskNote);
  render(editor({ onSave, onReadRemote }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  }); // the mount's own check resolves

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  }); // past the remote-check throttle
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  }); // debounce fires; onSave now in flight
  expect(onSave).toHaveBeenCalledTimes(1);

  onReadRemote.mockClear();
  window.dispatchEvent(new Event('focus')); // a remote check races the in-flight save
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(onReadRemote).not.toHaveBeenCalled();

  await act(async () => {
    resolveSave?.();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nMore.');
});

it('lets close proceed while a local autosave is still in flight', async () => {
  let resolveSave: ((value: NoteItem) => void) | null = null;
  const gate = new Promise<NoteItem>(resolve => {
    resolveSave = resolve;
  });
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => {
    await gate;
    return { ...note, content, metadata: { ...metadata, updated: 't1' } };
  });
  const onClose = vi.fn();
  render(editor({ onSave, onClose }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  }); // debounce fires; autosave now awaiting the gate
  expect(onSave).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByLabelText('Close note'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  // close() proceeded to its own save instead of being blocked by the in-flight autosave.
  expect(onSave).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolveSave?.(note);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(onClose).toHaveBeenCalled();
});

it('discards a stale autosave superseded by a remote merge, saving the merged content once', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...start, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ note: start, onReadRemote, onSave }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  }); // the mount's own check resolves

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  }); // past the remote-check throttle
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus')); // a remote check starts, holding operation.current
  expect(onReadRemote).toHaveBeenCalledTimes(2);

  // The debounce elapses while the check is still in flight; the autosave must wait, not save yet.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });
  expect(onSave).not.toHaveBeenCalled();

  // The check resolves with an unrelated external change; it merges cleanly with the local edit.
  await act(async () => {
    resolveRead?.({ ...start, content: 'line1\nline2\nREMOTE3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('LOCAL1\nline2\nREMOTE3\n');

  // The stale autosave, still holding the pre-merge draft, must not fire now that it's free to.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(onSave).not.toHaveBeenCalled();

  // The fresh effect's own debounce, scheduled for the merged content, saves it once.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].content).toBe('LOCAL1\nline2\nREMOTE3\n');
});

it('merges a concurrent local edit with an unrelated external change', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  render(editor({ note: start, onReadRemote }));
  // The immediate mount check: resolve it as a no-op so the throttle starts from a known point.
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  }); // past the remote-check throttle
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  expect(onReadRemote).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveRead?.({ ...start, content: 'line1\nline2\nREMOTE3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });

  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('LOCAL1\nline2\nREMOTE3\n');
  expect(screen.getByText(/Remote changes merged/i)).toBeTruthy();
});

it('blocks on an external change that conflicts with the unsaved local edit, preserving the draft', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  render(editor({ note: start, onReadRemote }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  expect(onReadRemote).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveRead?.({ ...start, content: 'REMOTE1\nline2\nline3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });

  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('LOCAL1\nline2\nline3\n');
  expect(screen.getByText(/conflict/i)).toBeTruthy();
});

it('adopts a remote-only change silently when there are no local edits (draft mode), without staging a draft or showing a notice', async () => {
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...note, content, metadata: { ...metadata, updated: 't1' } }));
  const onReadRemote = vi.fn(async () => ({ ...note, content: '# Alpha\nExternal change.\n', metadata: { title: 'Alpha', updated: 't1' } }));
  render(editor({ draftMode: true, onSave, onReadRemote }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe('# Alpha\nExternal change.\n');
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();
});

it('does not re-stage an existing working draft when it is reopened with no new edits', async () => {
  const base: NoteItem = { ...note, content: '# Alpha\n' };
  const staged: NoteItem = { ...note, content: '# Alpha\nStaged edit.\n' };
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...staged, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ draftMode: true, note: staged, remoteBase: base, onSave }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });

  expect(onSave).not.toHaveBeenCalled();
});

it('re-stages the working draft to clear it when the user edits the content back to match the base', async () => {
  const base: NoteItem = { ...note, content: '# Alpha\n' };
  const staged: NoteItem = { ...note, content: '# Alpha\nStaged edit.\n' };
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...staged, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ draftMode: true, note: staged, remoteBase: base, onSave }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  onSave.mockClear();

  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: base.content } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].content).toBe(base.content);
});

it('does not re-save the content it just refreshed in on the next debounce tick', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...start, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ note: start, onReadRemote, onSave }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  }); // the mount's own check resolves

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  }); // past the remote-check throttle
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  await act(async () => {
    resolveRead?.({ ...start, content: 'REMOTE1\nline2\nline3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/conflict/i)).toBeTruthy(); // blocked on the conflict

  const refreshed: NoteItem = { ...start, content: 'REMOTE1\nline2\nline3\n' };
  onReadRemote.mockImplementation(async () => refreshed);
  fireEvent.click(screen.getByText('Refresh remote version'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe(refreshed.content);

  onSave.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  }); // past the disk-write debounce
  expect(onSave).not.toHaveBeenCalled();
});

it('does not flag the note as unsaved again right after an explicit save', async () => {
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...note, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ autoSave: false, onSave }));
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  fireEvent.click(screen.getByLabelText('Save to remote repository'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(onSave).toHaveBeenCalledTimes(1);

  onSave.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(onSave).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Save to remote repository') as HTMLButtonElement).disabled).toBe(true);
});

it('does not write the restored content back to disk with a new timestamp', async () => {
  const head: NoteItem = { ...note, content: '# Alpha\nHEAD version.\n', metadata: { title: 'Alpha', updated: 'thead' } };
  const onRestoreFile = vi.fn(async () => head);
  const onSave = vi.fn(async ({ content, metadata }: { content: string; metadata?: Record<string, unknown>; }) => ({ ...note, content, metadata: { ...metadata, updated: 't1' } }));
  render(editor({ frame: 'zoom', isDirty: true, onRestoreFile, onSave }));

  fireEvent.click(screen.getByLabelText('File Git status')); // opens the Git panel, which hosts the restore control
  fireEvent.click(screen.getByLabelText('Restore note'));
  fireEvent.click(screen.getByLabelText('Confirm restore note'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect((screen.getByLabelText('Note content') as HTMLTextAreaElement).value).toBe(head.content);

  onSave.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(onSave).not.toHaveBeenCalled();
});

it('dismissing the merged notice hides it', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  render(editor({ note: start, onReadRemote, autoSave: false }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  await act(async () => {
    resolveRead?.({ ...start, content: 'line1\nline2\nREMOTE3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/Remote changes merged/i)).toBeTruthy();

  fireEvent.click(screen.getByLabelText('Dismiss notice'));
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();
});

it('shows the merged notice again on a later, different merge, even though it was dismissed', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  render(editor({ note: start, onReadRemote, autoSave: false }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  const afterFirstMerge: NoteItem = { ...start, content: 'line1\nline2\nREMOTE3\n' };
  await act(async () => {
    resolveRead?.(afterFirstMerge);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/Remote changes merged/i)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Dismiss notice'));
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();

  // A recheck that finds nothing new leaves the dismissal in place.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  await act(async () => {
    resolveRead?.(afterFirstMerge);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.queryByText(/Remote changes merged/i)).toBeNull();

  // A fresh local edit merged with a new external change is a new, different event.
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nLOCAL2\nREMOTE3\n' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  await act(async () => {
    resolveRead?.({ ...afterFirstMerge, content: 'line1\nline2\nREMOTE3B\n' });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(/Remote changes merged/i)).toBeTruthy();
});

it('does not offer a dismiss control while blocked on a conflict', async () => {
  const start: NoteItem = { ...note, content: 'line1\nline2\nline3\n' };
  let resolveRead: ((value: NoteItem) => void) | null = null;
  const onReadRemote = vi.fn((): Promise<NoteItem> =>
    new Promise(resolve => {
      resolveRead = resolve;
    })
  );
  render(editor({ note: start, onReadRemote }));
  await act(async () => {
    resolveRead?.(start);
    await vi.advanceTimersByTimeAsync(0);
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(61000);
  });
  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'LOCAL1\nline2\nline3\n' } });
  window.dispatchEvent(new Event('focus'));
  await act(async () => {
    resolveRead?.({ ...start, content: 'REMOTE1\nline2\nline3\n' });
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(screen.getByText(/conflict/i)).toBeTruthy();
  expect(screen.queryByLabelText('Dismiss notice')).toBeNull();
});
