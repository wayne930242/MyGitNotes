import { describe, expect, it } from 'vitest';
import { parseNoteContent, serializeNoteContent } from '../src/frontmatter.js';

// Evidence: changing `status` through the MyGitNotes UI on this exact note rewrote the whole
// frontmatter block — title lost its quotes, `tags` turned from flow into block style, and a
// blank line appeared before the body. A metadata-only edit must change only the edited key
// (plus `updated`, which changes by design) and leave the body byte-identical.
const evidenceRaw = ['---', 'title: "Keys"', 'tags: [技術, 筆記]', 'sticker: emoji//1f469-200d-1f9b3', 'status: inbox', 'created: "2026-09-16T08:32:02.000Z"', 'updated: "2026-09-17T15:21:41.000Z"', '---', '### NPM backup', '33ab3399cbe4e1b1cfbb49091af56dc7646e358d4eea769c3f4c5db568ff4113', 'aaafcd2fbb342654ac6713cf5e7bc26f07d724bbd473f7df1523b876095b9bd2', ''].join('\n');

describe('serializeNoteContent patches an existing frontmatter block in place', () => {
  it('changing status only touches status and updated, leaving everything else byte-identical', () => {
    const { metadata, content } = parseNoteContent(evidenceRaw);
    const now = new Date('2026-09-19T07:22:17.552Z');

    const serialized = serializeNoteContent({ ...metadata, status: 'working' }, content, false, now, evidenceRaw);

    expect(serialized).toBe(evidenceRaw.replace('status: inbox', 'status: working').replace('updated: "2026-09-17T15:21:41.000Z"', 'updated: "2026-09-19T07:22:17.552Z"'));
    // Explicitly confirm the previously-observed regressions did not happen.
    expect(serialized).toContain('title: "Keys"');
    expect(serialized).toContain('tags: [技術, 筆記]');
    expect(serialized).toContain('---\n### NPM backup');
  });

  it('a resave with no metadata change and the same `updated` instant is a byte-identical no-op', () => {
    const { metadata, content } = parseNoteContent(evidenceRaw);
    const serialized = serializeNoteContent(metadata, content, false, new Date('2026-09-17T15:21:41.000Z'), evidenceRaw);
    expect(serialized).toBe(evidenceRaw);
  });

  it('preserves an unrelated block-style array, comments and unknown keys when another field changes', () => {
    const raw = '---\n# lead comment\ntitle: Note\ntags:\n  - alpha\n  - beta\ncustom: value # trailing\nstatus: todo\ncreated: "2020-01-01T00:00:00.000Z"\nupdated: "2020-01-02T00:00:00.000Z"\n---\n\nBody.\n';
    const { metadata, content } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, status: 'done' }, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    expect(serialized).toBe(raw.replace('status: todo', 'status: done').replace('updated: "2020-01-02T00:00:00.000Z"', 'updated: "2026-01-01T00:00:00.000Z"'));
  });

  it('appends a brand-new metadata key without disturbing existing fields, quoting a newly-stamped `updated`', () => {
    const raw = '---\ntitle: Note\n---\n\nBody.\n';
    const { metadata, content } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, priority: 'high' }, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    expect(serialized).toBe('---\ntitle: Note\npriority: high\nupdated: "2026-01-01T00:00:00.000Z"\n---\n\nBody.\n');
  });

  it('inserts a new array-valued key onto a flow-style root map without corrupting it', () => {
    const raw = '---\n{title: Note, status: todo}\n---\n\nBody.\n';
    const { metadata, content } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, tags: ['a', 'b'] }, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.hasFrontmatter).toBe(true);
    expect(reparsed.metadata).toEqual({ title: 'Note', status: 'todo', tags: ['a', 'b'], updated: '2026-01-01T00:00:00.000Z' });
    expect(reparsed.content).toBe(content);
    expect(serialized).not.toContain('\n  - a');
  });

  it('quotes a newly-inserted metadata key name that would otherwise break the YAML map', () => {
    const raw = '---\ntitle: Note\n---\n\nBody.\n';
    const { metadata, content } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, 'a: b': 'value' }, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.hasFrontmatter).toBe(true);
    expect(reparsed.metadata['a: b']).toBe('value');
    expect(reparsed.content).toBe(content);
  });

  it('removes a metadata key that is no longer present', () => {
    const raw = '---\ntitle: Note\narchived: true\ncreated: "2020-01-01T00:00:00.000Z"\nupdated: "2020-01-02T00:00:00.000Z"\n---\n\nBody.\n';
    const { metadata, content } = parseNoteContent(raw);
    const { archived, ...rest } = metadata;
    const serialized = serializeNoteContent(rest, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    expect(serialized).toBe('---\ntitle: Note\ncreated: "2020-01-01T00:00:00.000Z"\nupdated: "2026-01-01T00:00:00.000Z"\n---\n\nBody.\n');
  });

  it('keeps CRLF line endings intact', () => {
    const raw = '---\r\ntitle: Note\r\nstatus: todo\r\ncreated: "2020-01-01T00:00:00.000Z"\r\nupdated: "2020-01-02T00:00:00.000Z"\r\n---\r\nBody.\r\n';
    const { metadata, content } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, status: 'done' }, content, false, new Date('2026-01-01T00:00:00.000Z'), raw);
    expect(serialized).toBe(raw.replace('status: todo', 'status: done').replace('updated: "2020-01-02T00:00:00.000Z"', 'updated: "2026-01-01T00:00:00.000Z"'));
  });

  it('falls back to a full render when the Markdown body itself changed', () => {
    const raw = '---\ntitle: "Keys"\ntags: [a, b]\n---\nOld body.\n';
    const { metadata } = parseNoteContent(raw);
    const serialized = serializeNoteContent({ ...metadata, status: 'done' }, 'New body.', false, new Date('2026-01-01T00:00:00.000Z'), raw);
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.content.trim()).toBe('New body.');
    expect(reparsed.metadata.status).toBe('done');
  });

  it('falls back to a full render when there is no existing frontmatter to patch onto', () => {
    const raw = '# Heading\n\nBody.\n';
    const serialized = serializeNoteContent({ title: 'New', status: 'todo' }, '# Heading\n\nBody.', true, new Date('2026-01-01T00:00:00.000Z'), raw);
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.metadata.status).toBe('todo');
    expect(reparsed.content.trim()).toBe('# Heading\n\nBody.');
  });
});
