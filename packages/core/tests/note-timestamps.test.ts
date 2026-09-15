import { describe, it, expect } from 'vitest';
import { fillMissingTimestamps, stampSaveTimestamps } from '../src/note-timestamps.js';
import { serializeNoteContent, parseNoteContent, fillMissingNoteTimestamps, replaceNoteStatus } from '../src/frontmatter.js';

describe('stampSaveTimestamps', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('sets created on a new note with no existing timestamps', () => {
    const stamped = stampSaveTimestamps({}, now);
    expect(stamped.created).toBe('2026-09-15T10:00:00.000Z');
    expect(stamped.updated).toBe('2026-09-15T10:00:00.000Z');
  });

  it('keeps an existing created value but always refreshes updated', () => {
    const stamped = stampSaveTimestamps({ created: '2020-01-01T00:00:00.000Z', updated: '2020-01-02T00:00:00.000Z' }, now);
    expect(stamped.created).toBe('2020-01-01T00:00:00.000Z');
    expect(stamped.updated).toBe('2026-09-15T10:00:00.000Z');
  });

  it('does not mutate the input object', () => {
    const input = { title: 'Note' };
    stampSaveTimestamps(input, now);
    expect(input).toEqual({ title: 'Note' });
  });
});

describe('fillMissingTimestamps', () => {
  it('fills both fields when missing', () => {
    const { metadata, changed } = fillMissingTimestamps({}, '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z');
    expect(metadata.created).toBe('2020-01-01T00:00:00.000Z');
    expect(metadata.updated).toBe('2021-01-01T00:00:00.000Z');
    expect(changed).toBe(true);
  });

  it('never overwrites an existing value', () => {
    const { metadata, changed } = fillMissingTimestamps(
      { created: '2015-09-17T16:48:45.115Z', updated: '2015-09-18T00:00:00.000Z' },
      '2020-01-01T00:00:00.000Z',
      '2021-01-01T00:00:00.000Z'
    );
    expect(metadata.created).toBe('2015-09-17T16:48:45.115Z');
    expect(metadata.updated).toBe('2015-09-18T00:00:00.000Z');
    expect(changed).toBe(false);
  });

  it('fills only the missing field', () => {
    const { metadata, changed } = fillMissingTimestamps(
      { created: '2015-09-17T16:48:45.115Z' },
      '2020-01-01T00:00:00.000Z',
      '2021-01-01T00:00:00.000Z'
    );
    expect(metadata.created).toBe('2015-09-17T16:48:45.115Z');
    expect(metadata.updated).toBe('2021-01-01T00:00:00.000Z');
    expect(changed).toBe(true);
  });

  it('leaves a field unset when no fallback is available', () => {
    const { metadata, changed } = fillMissingTimestamps({}, undefined, '2021-01-01T00:00:00.000Z');
    expect(metadata.created).toBeUndefined();
    expect(metadata.updated).toBe('2021-01-01T00:00:00.000Z');
    expect(changed).toBe(true);
  });
});

describe('serializeNoteContent timestamp stamping', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');

  it('stamps created and updated on a brand-new note and quotes the ISO string in YAML', () => {
    const serialized = serializeNoteContent({ title: 'New note' }, 'Body.', now);
    expect(serialized).toContain('created: "2026-09-15T10:00:00.000Z"');
    expect(serialized).toContain('updated: "2026-09-15T10:00:00.000Z"');
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.metadata.created).toBe('2026-09-15T10:00:00.000Z');
    expect(reparsed.metadata.updated).toBe('2026-09-15T10:00:00.000Z');
  });

  it('preserves created and only refreshes updated on a resave', () => {
    const serialized = serializeNoteContent(
      { title: 'Existing note', created: '2015-09-17T16:48:45.115Z', updated: '2015-09-18T00:00:00.000Z' },
      'Body.',
      now
    );
    const reparsed = parseNoteContent(serialized);
    expect(reparsed.metadata.created).toBe('2015-09-17T16:48:45.115Z');
    expect(reparsed.metadata.updated).toBe('2026-09-15T10:00:00.000Z');
  });
});

describe('replaceNoteStatus does not touch note timestamps', () => {
  it('changes only status, leaving created/updated exactly as they were', () => {
    const raw = '---\ncreated: "2015-09-17T16:48:45.115Z"\nupdated: "2015-09-18T00:00:00.000Z"\nstatus: todo\n---\n\nBody.\n';
    const updated = replaceNoteStatus(raw, 'done');
    const reparsed = parseNoteContent(updated);
    expect(reparsed.metadata.status).toBe('done');
    expect(reparsed.metadata.created).toBe('2015-09-17T16:48:45.115Z');
    expect(reparsed.metadata.updated).toBe('2015-09-18T00:00:00.000Z');
  });

  it('adds no created/updated fields to a note that has none', () => {
    const raw = '---\nstatus: todo\n---\n\nBody.\n';
    const updated = replaceNoteStatus(raw, 'done');
    const reparsed = parseNoteContent(updated);
    expect(reparsed.metadata.created).toBeUndefined();
    expect(reparsed.metadata.updated).toBeUndefined();
  });
});

describe('fillMissingNoteTimestamps', () => {
  it('adds a frontmatter block when the note has none', () => {
    const raw = '# Heading\n\nBody.\n';
    const { raw: patched, changed } = fillMissingNoteTimestamps(raw, '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z');
    expect(changed).toBe(true);
    const reparsed = parseNoteContent(patched);
    expect(reparsed.metadata.created).toBe('2020-01-01T00:00:00.000Z');
    expect(reparsed.metadata.updated).toBe('2021-01-01T00:00:00.000Z');
    expect(reparsed.content.trim()).toBe('# Heading\n\nBody.'.trim());
  });

  it('fills only the missing key and leaves other fields and the body untouched', () => {
    const raw = '---\ntitle: Keep me\ncreated: "2015-09-17T16:48:45.115Z"\ncustom: value\n---\n\nBody text.\n';
    const { raw: patched, changed } = fillMissingNoteTimestamps(raw, '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z');
    expect(changed).toBe(true);
    expect(patched).toContain('created: "2015-09-17T16:48:45.115Z"');
    expect(patched).toContain('updated: "2021-01-01T00:00:00.000Z"');
    expect(patched).toContain('title: Keep me');
    expect(patched).toContain('custom: value');
    expect(patched).toContain('Body text.');
  });

  it('makes no change when both timestamps already exist', () => {
    const raw = '---\ncreated: "2015-09-17T16:48:45.115Z"\nupdated: "2015-09-18T00:00:00.000Z"\n---\n\nBody.\n';
    const { raw: patched, changed } = fillMissingNoteTimestamps(raw, '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z');
    expect(changed).toBe(false);
    expect(patched).toBe(raw);
  });

  it('makes no change when no fallback dates are available', () => {
    const raw = '# Heading\n\nBody.\n';
    const { raw: patched, changed } = fillMissingNoteTimestamps(raw, undefined, undefined);
    expect(changed).toBe(false);
    expect(patched).toBe(raw);
  });
});
