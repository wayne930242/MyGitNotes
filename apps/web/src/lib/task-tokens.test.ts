import { describe, expect, it } from 'vitest';
import { classifyDueDate, DONE_EMOJI, DUE_EMOJI, findToken, getTokenValue, isTaskChecked, isTaskLine, setTaskChecked, setTokenValue, TIMESTAMP_EMOJI } from './task-tokens.js';

describe('isTaskLine / isTaskChecked', () => {
  it('recognizes GFM task markers with -, *, or +', () => {
    expect(isTaskLine('- [ ] Buy milk')).toBe(true);
    expect(isTaskLine('* [x] Done thing')).toBe(true);
    expect(isTaskLine('+ [X] Also done')).toBe(true);
    expect(isTaskLine('- Not a task')).toBe(false);
    expect(isTaskLine('Plain text')).toBe(false);
  });

  it('reads the checked state', () => {
    expect(isTaskChecked('- [ ] Buy milk')).toBe(false);
    expect(isTaskChecked('- [x] Done')).toBe(true);
    expect(isTaskChecked('- [X] Done')).toBe(true);
    expect(isTaskChecked('Not a task')).toBeUndefined();
  });
});

describe('token parsing', () => {
  it('finds a due-date token', () => {
    const match = findToken('- [ ] Buy milk 📅 2026-09-20', DUE_EMOJI);
    expect(match?.value).toBe('2026-09-20');
    expect(getTokenValue('- [ ] Buy milk 📅 2026-09-20', DUE_EMOJI)).toBe('2026-09-20');
  });

  it('finds a done-date token', () => {
    expect(getTokenValue('- [x] Buy milk ✅ 2026-09-15', DONE_EMOJI)).toBe('2026-09-15');
  });

  it('finds a timestamp token with date and time', () => {
    expect(getTokenValue('Meeting notes 🕒 2026-09-15 14:32', TIMESTAMP_EMOJI, true)).toBe('2026-09-15 14:32');
    expect(getTokenValue('No timestamp here', TIMESTAMP_EMOJI, true)).toBeUndefined();
  });

  it('does not confuse a due-date token for a timestamp token', () => {
    expect(getTokenValue('- [ ] Task 📅 2026-09-20', TIMESTAMP_EMOJI, true)).toBeUndefined();
  });
});

describe('setTokenValue', () => {
  it('appends a new token when none exists', () => {
    expect(setTokenValue('- [ ] Buy milk', DUE_EMOJI, '2026-09-20')).toBe('- [ ] Buy milk 📅 2026-09-20');
  });

  it('replaces an existing token value', () => {
    expect(setTokenValue('- [ ] Buy milk 📅 2026-09-20', DUE_EMOJI, '2026-09-25')).toBe('- [ ] Buy milk 📅 2026-09-25');
  });

  it('removes a token and trailing whitespace when value is null', () => {
    expect(setTokenValue('- [ ] Buy milk 📅 2026-09-20', DUE_EMOJI, null)).toBe('- [ ] Buy milk');
  });

  it('is a no-op removing a token that is not present', () => {
    expect(setTokenValue('- [ ] Buy milk', DUE_EMOJI, null)).toBe('- [ ] Buy milk');
  });
});

describe('setTaskChecked (done-date add/remove)', () => {
  it('checks a task and appends the done-date token', () => {
    expect(setTaskChecked('- [ ] Buy milk', true, '2026-09-15')).toBe('- [x] Buy milk ✅ 2026-09-15');
  });

  it('unchecks a task and removes the done-date token', () => {
    expect(setTaskChecked('- [x] Buy milk ✅ 2026-09-15', false, '2026-09-15')).toBe('- [ ] Buy milk');
  });

  it('preserves a due-date token while toggling done', () => {
    expect(setTaskChecked('- [ ] Buy milk 📅 2026-09-20', true, '2026-09-15')).toBe('- [x] Buy milk 📅 2026-09-20 ✅ 2026-09-15');
  });

  it('replaces an existing done-date when re-checked with a new date', () => {
    expect(setTaskChecked('- [x] Buy milk ✅ 2026-09-01', true, '2026-09-15')).toBe('- [x] Buy milk ✅ 2026-09-15');
  });

  it('leaves a non-task line unchanged', () => {
    expect(setTaskChecked('Not a task', true, '2026-09-15')).toBe('Not a task');
  });
});

describe('classifyDueDate', () => {
  const today = '2026-09-15';

  it('classifies overdue, today, upcoming, and no date', () => {
    expect(classifyDueDate('2026-09-10', today)).toBe('overdue');
    expect(classifyDueDate('2026-09-15', today)).toBe('today');
    expect(classifyDueDate('2026-09-20', today)).toBe('upcoming');
    expect(classifyDueDate(undefined, today)).toBe('noDate');
  });
});
