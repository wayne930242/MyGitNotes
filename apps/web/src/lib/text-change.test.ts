import { expect, it } from 'vitest';
import { textChange } from './text-change.js';

it('replaces only the span between the common prefix and suffix', () => {
  expect(textChange('a\nb\nc', 'a\nb\nc')).toBeNull();
  expect(textChange('one two three', 'one 2 three')).toEqual({ from: 4, to: 7, insert: '2' });
  expect(textChange('head\ntail', 'head\nmiddle\ntail')).toEqual({ from: 5, to: 5, insert: 'middle\n' });
  expect(textChange('head\nmiddle\ntail', 'head\ntail')).toEqual({ from: 5, to: 12, insert: '' });
  expect(textChange('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
});

it('does not let a repeated character make the prefix and suffix overlap', () => {
  expect(textChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
  expect(textChange('abab', 'ab')).toEqual({ from: 2, to: 4, insert: '' });
});

it('never splits a surrogate pair', () => {
  const change = textChange('x😀y', 'x😃y')!;
  expect(change).toEqual({ from: 1, to: 3, insert: '😃' });
});
