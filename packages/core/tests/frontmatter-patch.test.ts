import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { patchFrontmatterField } from '../src/frontmatter-patch.js';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function reparse(raw: string): Record<string, unknown> {
  const match = raw.match(FRONTMATTER_REGEX);
  expect(match).not.toBeNull();
  return YAML.parse(match![1]);
}

describe('patchFrontmatterField', () => {
  it('patches a key that renders quoted, without corrupting the surrounding YAML', () => {
    const raw = '---\n"a: b": old\ncustom: keep\n---\n# Body\n';
    const patched = patchFrontmatterField(raw, 'a: b', 'first\nsecond');

    const parsed = reparse(patched);
    expect(parsed['a: b']).toBe('first\nsecond');
    expect(parsed.custom).toBe('keep');
  });

  it('preserves every trailing newline when the patched field is the last one and its value ends in a blank line', () => {
    const raw = '---\nname: review\ndescription: hello\n---\n# Body\n';
    const patched = patchFrontmatterField(raw, 'description', 'first\n\n');

    const parsed = reparse(patched);
    expect(parsed.description).toBe('first\n\n');
  });

  it('preserves every trailing newline when the patched field is the sole key with a multi-blank-line value', () => {
    const raw = '---\ndescription: hello\n---\n# Body\n';
    const patched = patchFrontmatterField(raw, 'description', 'first\n\n\n');

    const parsed = reparse(patched);
    expect(parsed.description).toBe('first\n\n\n');
  });

  it.each([['boolean true', 'true'], ['boolean false', 'false'], ['null', 'null'], ['numeric', '42'], ['ordinary string (control)', 'name']])('patches an existing %s key in place instead of appending a duplicate', (_label, key) => {
    const raw = `---\n${key}: old\ncustom: keep\n---\n# Body\n`;
    const patched = patchFrontmatterField(raw, key, 'new');

    const match = patched.match(FRONTMATTER_REGEX);
    expect(match).not.toBeNull();
    const items = (YAML.parseDocument(match![1]).contents as YAML.YAMLMap).items;
    expect(items).toHaveLength(2);
    const patchedItem = items.find(item => String((item.key as YAML.Scalar).value) === key);
    expect((patchedItem!.value as YAML.Scalar).value).toBe('new');
    expect(patched.match(new RegExp(`^${key}:`, 'gm'))).toHaveLength(1);
  });
});
