import { describe, expect, it } from 'vitest';
import { parseNoteContent, serializeNoteContent } from '../src/frontmatter.js';

describe('Frontmatter Parser & Serializer', () => {
  it('parses markdown with full YAML frontmatter', () => {
    const raw = `---
id: test-note
title: Custom Title
status: in-progress
tags:
  - alpha
  - beta
custom_field: 42
nested:
  author: Alice
---

# Heading One

Body text here.
`;
    const parsed = parseNoteContent(raw, 'fallback.md');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.title).toBe('Custom Title');
    expect(parsed.metadata.id).toBe('test-note');
    expect(parsed.metadata.status).toBe('in-progress');
    expect(parsed.metadata.tags).toEqual(['alpha', 'beta']);
    expect(parsed.metadata.custom_field).toBe(42);
    expect(parsed.metadata.nested).toEqual({ author: 'Alice' });
    expect(parsed.content.trim()).toBe('# Heading One\n\nBody text here.');
    expect(parsed.lineNumberOffset).toBe(11);
  });

  it('preserves unknown frontmatter keys during round-trip serialization', () => {
    const originalMetadata = { id: 'custom-123', title: 'Preserved Title', status: 'todo', tags: ['one'], unknown_flag: true, arbitrary_object: { key: 'value', numbers: [1, 2, 3] } };
    const body = 'This is the note content that should remain unchanged.';

    const serialized = serializeNoteContent(originalMetadata, body, true);
    const reparsed = parseNoteContent(serialized);

    expect(reparsed.title).toBe('Preserved Title');
    expect(reparsed.metadata.unknown_flag).toBe(true);
    expect(reparsed.metadata.arbitrary_object).toEqual({ key: 'value', numbers: [1, 2, 3] });
    expect(reparsed.content.trim()).toBe(body);
  });

  it('handles markdown with no frontmatter gracefully', () => {
    const raw = '# Just Markdown\n\nNo frontmatter at all.';
    const parsed = parseNoteContent(raw, 'my-file.md');

    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.title).toBe('Just Markdown');
    expect(parsed.metadata).toEqual({});
    expect(parsed.content).toBe(raw);
    expect(parsed.lineNumberOffset).toBe(0);
  });

  it('falls back to first H1 when title is absent from frontmatter', () => {
    const raw = `---
status: todo
---

# Extracted H1 Title

Paragraph.
`;
    const parsed = parseNoteContent(raw, 'filename.md');
    expect(parsed.title).toBe('Extracted H1 Title');
  });

  it('falls back to filename when title and H1 are absent', () => {
    const raw = `---
status: todo
---

Just a plain paragraph without headers.
`;
    const parsed = parseNoteContent(raw, 'notes/my-awesome-note.md');
    expect(parsed.title).toBe('my-awesome-note');
  });

  it('falls back to Untitled when title, H1, and filename are absent', () => {
    const raw = 'Just a plain paragraph.';
    const parsed = parseNoteContent(raw);
    expect(parsed.title).toBe('Untitled');
  });

  it('does not throw when status is missing', () => {
    const raw = `---
title: Note without status
---

Content.
`;
    const parsed = parseNoteContent(raw);
    expect(parsed.metadata.status).toBeUndefined();
    expect(parsed.title).toBe('Note without status');
  });
});
