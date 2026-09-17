import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { classifyResource } from '../src/classifier.js';
import { WORKSPACE_CONFIG_FILENAME } from '../src/config.js';

describe('Core Repository & Invariant Guardrails', () => {
  it('prevents product maintenance from treating user notes/** as Core-owned source', () => {
    // 1. In Core source classification, notes/** belongs to user content, not product_source
    const userNoteClassification = classifyResource('notes/personal/my-secret.md');
    expect(userNoteClassification.type).toBe('note');
    expect(userNoteClassification.type).not.toBe('product_source');
  });

  it('keeps starter examples in Core and classifies copied files as workspace content', () => {
    const projectRoot = path.resolve(__dirname, '../../../');
    const template = path.join(projectRoot, 'examples/demo-workspace');
    expect(fs.existsSync(path.join(template, WORKSPACE_CONFIG_FILENAME))).toBe(true);
    expect(fs.existsSync(path.join(template, 'notes/example/welcome.md'))).toBe(true);
    expect(classifyResource('examples/demo-workspace/notes/example/welcome.md').type).toBe('product_source');
    expect(classifyResource('.mygitnotes.yaml').type).toBe('workspace_config');
    expect(classifyResource('notes/.mygitnotes.yaml').type).toBe('workspace_config');
    expect(classifyResource('.github-notes.yaml').type).toBe('workspace_config');
    expect(classifyResource('notes/.github-notes.yaml').type).toBe('workspace_config');
    expect(classifyResource('notes/AGENTS.md').type).toBe('agent_instruction');
    expect(classifyResource('notes/example/welcome.md').type).toBe('note');
  });
});
