// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Select } from './Select.js';

beforeAll(() => {
  // Radix Select measures and captures the pointer, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(cleanup);

it('lists options under their group headings, in the order each group names them', async () => {
  render(createElement(Select, { 'aria-label': 'Notebook', value: 'kb~work', onValueChange: () => {}, options: [{ value: 'kb~work', label: 'Work' }, { value: 'campaign~trpg', label: 'TRPG' }, { value: 'kb~life', label: 'Life' }], groups: [{ label: 'Knowledge base', values: ['kb~life', 'kb~work'] }, { label: 'Campaign', values: ['campaign~trpg'] }] }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Notebook' }), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const groups = within(listbox).getAllByRole('group');
  expect(groups.map(group => [group.querySelector('.select-group-label')?.textContent, within(group).getAllByRole('option').map(option => option.textContent)])).toEqual([['Knowledge base', ['Life', 'Work']], ['Campaign', ['TRPG']]]);
});
