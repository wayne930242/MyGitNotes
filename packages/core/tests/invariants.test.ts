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

  it('ensures notes/ directory has .github-notes.yaml and example notebook at root', () => {
    const projectRoot = path.resolve(__dirname, '../../../');
    const notesConfig = path.join(projectRoot, 'notes', WORKSPACE_CONFIG_FILENAME);
    const welcomeNote = path.join(projectRoot, 'notes/example/welcome.md');
    const notesAgents = path.join(projectRoot, 'notes/AGENTS.md');
    const notebookAgents = path.join(projectRoot, 'notes/example/AGENTS.md');

    expect(fs.existsSync(notesConfig)).toBe(true);
    expect(fs.existsSync(welcomeNote)).toBe(true);
    expect(fs.existsSync(notesAgents)).toBe(true);
    expect(fs.existsSync(notebookAgents)).toBe(true);

    const welcomeContent = fs.readFileSync(welcomeNote, 'utf-8');
    expect(welcomeContent).toMatch(/^---\r?\nid: welcome/);

    expect(classifyResource('notes/.github-notes.yaml').type).toBe('workspace_config');
    expect(classifyResource('notes/AGENTS.md').type).toBe('agent_instruction');
    expect(classifyResource('notes/example/welcome.md').type).toBe('note');
  });
});
