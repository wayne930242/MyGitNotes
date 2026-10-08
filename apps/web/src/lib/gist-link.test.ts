import { describe, expect, it } from 'vitest';
import { gistLink } from './gist-link.js';

describe('gistLink', () => {
  it('opens on gist.github.com for a note published before the address was recorded', () => {
    expect(gistLink('abc123', undefined)).toBe('https://gist.github.com/abc123');
  });
  it('follows the address the Gist API returned, including one on an Enterprise site', () => {
    expect(gistLink('abc123', 'https://gist.github.com/octo/abc123')).toBe('https://gist.github.com/octo/abc123');
    expect(gistLink('abc123', 'https://ghe.example.com/gist/octo/abc123')).toBe('https://ghe.example.com/gist/octo/abc123');
  });
  it('ignores an address that is not an HTTPS link to that Gist', () => {
    for (const stored of ['javascript:alert(1)', 'http://ghe.example.com/gist/octo/abc123', 'https://user:pw@ghe.example.com/gist/octo/abc123', 'https://ghe.example.com/gist/octo/other', 'not a url', 42, '']) expect(gistLink('abc123', stored)).toBe('https://gist.github.com/abc123');
  });
});
