// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkspaceConfig } from '@mygitnotes/core';
import YAML from 'yaml';
import { I18nProvider } from '../lib/i18n/index.js';
import { WorkspaceManifestEditor } from './WorkspaceManifestEditor.js';

afterEach(cleanup);

const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'My Workspace', default_notebook: 'life' }, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', default_view: 'list', metadata: [{ key: 'mood' }], pathAliases: { '@life': 'notes/life' } }, { id: 'work', title: 'Work', root: 'notes/work', default_view: 'list' }], files: { hide_dotfiles: true }, preferences: { defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false } };

function editor(overrides: { yamlContent?: string; readOnly?: boolean; onChange?: (yaml: string) => void; } = {}) {
  const onChange = overrides.onChange ?? (() => {});
  return createElement(I18nProvider, null, createElement(WorkspaceManifestEditor, { yamlContent: overrides.yamlContent ?? YAML.stringify(config), onChange, readOnly: overrides.readOnly ?? false }));
}

describe('WorkspaceManifestEditor', () => {
  it('starts in Advanced mode with a focusable raw-YAML textarea', () => {
    render(editor());
    const textarea = screen.getByRole('textbox', { name: /manifest/i });
    expect(textarea.tagName).toBe('TEXTAREA');
    textarea.focus();
    expect(textarea).toHaveFocus();
  });

  it('switches to Form mode and edits the workspace title back into the YAML', () => {
    let latest = '';
    render(editor({
      onChange: yaml => {
        latest = yaml;
      },
    }));

    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    const titleInput = screen.getByDisplayValue('My Workspace');
    fireEvent.change(titleInput, { target: { value: 'Renamed Workspace' } });

    expect(YAML.parse(latest).workspace.title).toBe('Renamed Workspace');
  });

  it('edits a notebook root through the Form', () => {
    let latest = '';
    render(editor({
      onChange: yaml => {
        latest = yaml;
      },
    }));

    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    const rootInput = screen.getByDisplayValue('notes/work');
    fireEvent.change(rootInput, { target: { value: 'notes/work-renamed' } });

    const parsed = YAML.parse(latest) as WorkspaceConfig;
    expect(parsed.notebooks.find(nb => nb.id === 'work')?.root).toBe('notes/work-renamed');
  });

  it('toggles the default show-line-numbers preference', () => {
    let latest = '';
    render(editor({
      onChange: yaml => {
        latest = yaml;
      },
    }));

    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    fireEvent.click(screen.getByText('Default: Show Line Numbers'));

    expect((YAML.parse(latest) as WorkspaceConfig).preferences?.defaultShowLineNumbers).toBe(true);
  });

  it('shows an inline error in Form mode when the current YAML does not parse, without discarding Advanced mode', () => {
    render(editor({ yamlContent: 'not: [valid' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    expect(screen.getByText(/YAML has errors/)).toBeInTheDocument();
  });

  it('disables Form inputs when read-only', () => {
    render(editor({ readOnly: true }));
    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    expect(screen.getByDisplayValue('My Workspace')).toBeDisabled();
  });
});
