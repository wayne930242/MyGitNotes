// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LegacySchemaNotice } from './LegacySchemaNotice.js';

afterEach(cleanup);

it('tells a workspace on schema 2 to migrate locally, naming the command', () => {
  render(createElement(LegacySchemaNotice, { schemaVersion: 2 }));
  expect(screen.getByRole('status')).toHaveTextContent('schema 2');
  expect(screen.getByRole('status')).toHaveTextContent('pnpm migrate-workspace');
});
it('says nothing on the current schema or before the manifest has loaded', () => {
  const { container, rerender } = render(createElement(LegacySchemaNotice, { schemaVersion: 3 }));
  expect(container).toBeEmptyDOMElement();
  rerender(createElement(LegacySchemaNotice, { schemaVersion: undefined }));
  expect(container).toBeEmptyDOMElement();
});
