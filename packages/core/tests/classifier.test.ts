import { describe, it, expect } from 'vitest';
import { classifyResource, isHiddenPath } from '../src/classifier.js';
import { WorkspaceConfig } from '../src/types.js';

describe('Resource Classifier', () => {
  const sampleConfig: WorkspaceConfig = {
    schema_version: 1,
    workspace: {
      title: 'Test Workspace',
      default_notebook: 'example',
    },
    notebooks: [
      {
        id: 'example',
        title: 'Example Notebook',
        root: 'notes/example',
        assets: 'assets',
      },
    ],
  };

  it('classifies notes properly', () => {
    expect(classifyResource('notes/example/intro.md', sampleConfig).type).toBe('note');
    expect(classifyResource('notes/example/guide.mdx', sampleConfig).type).toBe('note');
    expect(classifyResource('notes/example/subfolder/idea.txt', sampleConfig).type).toBe('note');
  });

  it('classifies agent instructions', () => {
    expect(classifyResource('AGENTS.md', sampleConfig).type).toBe('agent_instruction');
    expect(classifyResource('notes/example/AGENTS.md', sampleConfig).type).toBe('agent_instruction');
  });

  it('classifies agent docs', () => {
    expect(classifyResource('docs/agent/index.md', sampleConfig).type).toBe('agent_doc');
    expect(classifyResource('docs/agent/security/rules.md', sampleConfig).type).toBe('agent_doc');
    expect(classifyResource('notes/example/docs/agent/guide.md', sampleConfig).type).toBe('agent_doc');
  });

  it('classifies workspace config', () => {
    expect(classifyResource('.mygitnotes.yaml', sampleConfig).type).toBe('workspace_config');
    expect(classifyResource('.github-notes.yaml', sampleConfig).type).toBe('workspace_config');
  });

  it('classifies assets in notebook asset directory', () => {
    expect(classifyResource('notes/example/assets/screenshot.png', sampleConfig).type).toBe('asset');
    expect(classifyResource('notes/example/assets/doc.pdf', sampleConfig).type).toBe('asset');
  });

  it('classifies assets under notebook pathAliases target directories', () => {
    const aliasedConfig: WorkspaceConfig = {
      ...sampleConfig,
      notebooks: [
        {
          id: 'blog',
          title: 'Blog',
          root: 'blog/src/content/posts',
          pathAliases: {
            '@/*': 'blog/src/*',
          },
        },
      ],
    };
    const res = classifyResource('blog/src/assets/images/two-params-weibull/fix-beta.png', aliasedConfig);
    expect(res.type).toBe('asset');
    expect(res.notebookId).toBe('blog');
  });

  it('classifies product source files', () => {
    expect(classifyResource('packages/core/src/index.ts', sampleConfig).type).toBe('product_source');
    expect(classifyResource('apps/web/src/App.tsx', sampleConfig).type).toBe('product_source');
    expect(classifyResource('scripts/update-core.ts', sampleConfig).type).toBe('product_source');
  });

  it('classifies hidden system files', () => {
    expect(classifyResource('.git/HEAD', sampleConfig).type).toBe('hidden');
    expect(classifyResource('node_modules/yaml/index.js', sampleConfig).type).toBe('hidden');
    expect(classifyResource('notes/example/.DS_Store', sampleConfig).type).toBe('hidden');
    expect(isHiddenPath('.git/config')).toBe(true);
    expect(isHiddenPath('.DS_Store')).toBe(true);
    expect(isHiddenPath('node_modules/foo')).toBe(true);
  });
});
