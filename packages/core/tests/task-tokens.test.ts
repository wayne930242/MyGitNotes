import { describe, expect, it } from 'vitest';
import { DUE_EMOJI, START_EMOJI, findToken, getTokenValue, setTokenValue, stripTaskTokens } from '../src/task-tokens.js';

describe('start-date token', () => {
  it('finds a start-date token', () => {
    const match = findToken('- [ ] Ship it 🛫 2026-09-20', START_EMOJI);
    expect(match?.value).toBe('2026-09-20');
    expect(getTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI)).toBe('2026-09-20');
  });

  it('does not confuse a start-date token for a due-date token', () => {
    expect(getTokenValue('- [ ] Ship it 🛫 2026-09-20', DUE_EMOJI)).toBeUndefined();
  });

  it('sets, replaces, and clears a start-date token like the due-date token', () => {
    expect(setTokenValue('- [ ] Ship it', START_EMOJI, '2026-09-20')).toBe('- [ ] Ship it 🛫 2026-09-20');
    expect(setTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI, '2026-09-25')).toBe('- [ ] Ship it 🛫 2026-09-25');
    expect(setTokenValue('- [ ] Ship it 🛫 2026-09-20', START_EMOJI, null)).toBe('- [ ] Ship it');
  });

  it('coexists with a due-date token on the same line', () => {
    const line = setTokenValue(setTokenValue('- [ ] Ship it', START_EMOJI, '2026-09-20'), DUE_EMOJI, '2026-09-25');
    expect(line).toBe('- [ ] Ship it 🛫 2026-09-20 📅 2026-09-25');
    expect(getTokenValue(line, START_EMOJI)).toBe('2026-09-20');
    expect(getTokenValue(line, DUE_EMOJI)).toBe('2026-09-25');
  });
});

describe('stripTaskTokens', () => {
  it('removes the checkbox marker and every recognized date token', () => {
    expect(stripTaskTokens('- [ ] Ship it 🛫 2026-09-20 📅 2026-09-25')).toBe('Ship it');
    expect(stripTaskTokens('- [x] Done thing ✅ 2026-09-15')).toBe('Done thing');
  });

  it('leaves plain task text unchanged aside from the marker', () => {
    expect(stripTaskTokens('- [ ] Plain task')).toBe('Plain task');
  });

  it('strips a timestamp token even without a checkbox context change', () => {
    expect(stripTaskTokens('- [ ] Logged 🕒 2026-09-15 14:32')).toBe('Logged');
  });
});
