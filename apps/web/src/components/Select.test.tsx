import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select } from './Select.js';

describe('Select before the menu is mounted', () => {
  it.each([
    ['done', 'Completed'],
    ['', 'No status'],
  ])('displays the label for %j without opening the menu', (value, label) => {
    const html = renderToStaticMarkup(createElement(Select, { 'aria-label': 'Status', value,
      onValueChange: () => {}, options: [
        { value: '', label: 'No status' },
        { value: 'done', label: 'Completed' },
      ],
    }));
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });
});
