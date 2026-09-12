import { describe, it, expect } from 'vitest';
import {
  generateCommitMessage,
  getDeterministicFallback,
  DEFAULT_GEMINI_MODEL,
  DETERMINISTIC_FALLBACK_MESSAGE,
} from '../src/semantic-commit.js';

describe('Semantic Commit Generator', () => {
  it('returns minor-mod for small diffs', () => {
    const diff = '@@ -1 +1 @@\n-old\n+new';
    expect(getDeterministicFallback('note.md', diff)).toBe(DETERMINISTIC_FALLBACK_MESSAGE);
  });

  it('returns file-specific conventional message for larger diffs without AI', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `+line ${i}`).join('\n');
    const diff = `@@ -1,5 +1,25 @@\n${lines}`;
    expect(getDeterministicFallback('notes/personal/my-ideas.md', diff)).toBe(
      'docs(notes): update my-ideas'
    );
  });

  it('falls back seamlessly to deterministic message when API key is missing', async () => {
    const diff = '@@ -1,10 +1,20 @@\n' + Array(15).fill('+content').join('\n');
    const msg = await generateCommitMessage({
      apiKey: '',
      diff,
      filePath: 'notes/example/welcome.md',
    });
    expect(msg).toBe('docs(notes): update welcome');
  });

  it('falls back smoothly when AI network call fails or throws', async () => {
    const msg = await generateCommitMessage({
      apiKey: 'fake_key_that_fails',
      model: DEFAULT_GEMINI_MODEL,
      diff: '@@ -1,15 +1,30 @@\n' + Array(20).fill('+test line').join('\n'),
      filePath: 'notes/example/guide.md',
    });
    // Should return deterministic fallback instead of throwing error
    expect(msg).toBe('docs(notes): update guide');
  });
});
