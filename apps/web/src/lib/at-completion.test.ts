import { describe, expect, it } from 'vitest';
import { getAtCompletionItems } from './at-completion.js';

const now = new Date(2026, 8, 15, 14, 32); // Tuesday, 2026-09-15 14:32

describe('getAtCompletionItems', () => {
  it('offers now/today/yesterday/tomorrow anywhere', () => {
    const items = getAtCompletionItems({ onTaskLine: false, now });
    expect(items.map(item => item.id)).toEqual(['now', 'today', 'yesterday', 'tomorrow']);
    expect(items.find(item => item.id === 'now')?.insertText).toBe('🕒 2026-09-15 14:32');
    expect(items.find(item => item.id === 'today')?.insertText).toBe('🕒 2026-09-15');
    expect(items.find(item => item.id === 'yesterday')?.insertText).toBe('🕒 2026-09-14');
    expect(items.find(item => item.id === 'tomorrow')?.insertText).toBe('🕒 2026-09-16');
  });

  it('adds due-date items and a date picker item on a task line', () => {
    const items = getAtCompletionItems({ onTaskLine: true, now });
    const ids = items.map(item => item.id);
    expect(ids).toEqual([
      'now', 'today', 'yesterday', 'tomorrow',
      'due-today', 'due-tomorrow', 'due-next-monday', 'pick-date',
      'start-today', 'start-tomorrow', 'start-next-monday', 'pick-start-date',
    ]);
    expect(items.find(item => item.id === 'due-today')?.insertText).toBe('📅 2026-09-15');
    expect(items.find(item => item.id === 'due-tomorrow')?.insertText).toBe('📅 2026-09-16');
    expect(items.find(item => item.id === 'due-next-monday')?.insertText).toBe('📅 2026-09-21');
  });

  it('adds start-date items on a task line', () => {
    const items = getAtCompletionItems({ onTaskLine: true, now });
    expect(items.find(item => item.id === 'start-today')?.insertText).toBe('🛫 2026-09-15');
    expect(items.find(item => item.id === 'start-tomorrow')?.insertText).toBe('🛫 2026-09-16');
    expect(items.find(item => item.id === 'start-next-monday')?.insertText).toBe('🛫 2026-09-21');
  });

  it('leaves the pick-date items without insert text, tagged with which picker to open', () => {
    const items = getAtCompletionItems({ onTaskLine: true, now });
    const pickDue = items.find(item => item.id === 'pick-date');
    const pickStart = items.find(item => item.id === 'pick-start-date');
    expect(pickDue?.insertText).toBeUndefined();
    expect(pickDue?.pickTarget).toBe('due');
    expect(pickStart?.insertText).toBeUndefined();
    expect(pickStart?.pickTarget).toBe('start');
  });
});
