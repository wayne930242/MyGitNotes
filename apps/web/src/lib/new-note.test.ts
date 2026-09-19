import { describe, expect, it } from 'vitest';
import { buildNewNoteDraft } from './new-note.js';

describe('buildNewNoteDraft', () => {
  it('uses a plain heading and the user tags/status when no template is selected', () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['a'], status: 'inbox' });
    expect(draft.content).toBe('# My Note\n\nWrite your note here.\n');
    expect(draft.metadata).toEqual({ id: 'my-note', title: 'My Note', tags: ['a'] });
    expect(draft.status).toBe('inbox');
  });

  it("keeps the user's final tags and status even when the rendered template sets its own", () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['user-tag'], status: 'active', template: { content: '# templated\n', metadata: { title: 'My Note', tags: ['template-tag'], status: 'inbox' } } });
    expect(draft.content).toBe('# templated\n');
    expect(draft.metadata.tags).toEqual(['user-tag']);
    expect(draft.status).toBe('active');
  });

  it('keeps other template metadata fields that are not tags or status', () => {
    const draft = buildNewNoteDraft({ slug: 'my-note', title: 'My Note', tags: ['user-tag'], status: 'active', template: { content: '# templated\n', metadata: { created_on: '2026-09-16' } } });
    expect(draft.metadata).toEqual({ id: 'my-note', created_on: '2026-09-16', tags: ['user-tag'] });
  });
});
