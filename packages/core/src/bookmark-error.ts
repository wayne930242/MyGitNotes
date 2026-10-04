export class BookmarkError extends Error {
  constructor(public readonly code: 'invalid-target' | 'duplicate-target' | 'unknown-bookmark' | 'unknown-group' | 'invalid-position' | 'invalid-scope', message: string, public readonly existingId?: string) {
    super(message);
    this.name = 'BookmarkError';
  }
}
