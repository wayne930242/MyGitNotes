import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSync, Visitor } from 'oxc-parser';

/** Primary actions must use the shared component rather than a second color policy. */
describe('primary action consistency', () => {
  it('routes native primary actions through Button', () => {
    const root = path.resolve('apps/web/src');
    const violations: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(file); continue; }
        if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
        const text = fs.readFileSync(file, 'utf8');
        const source = parseSync(file, text);
        expect(source.errors, file).toEqual([]);
        new Visitor({
          JSXOpeningElement(node) {
            if (node.selfClosing || node.name.type !== 'JSXIdentifier' || node.name.name !== 'button') return;
            const attrs = text.slice(node.attributes[0]?.start ?? node.name.end, node.attributes.at(-1)?.end ?? node.name.end);
            if (attrs.includes('ui-button-primary') || /backgroundColor:\s*['"]var\(--color-primary\)['"]/.test(attrs) || attrs.includes('text-on-primary') && attrs.includes('bg-primary') || attrs.includes('mobile-nav-create')) {
              violations.push(`${path.relative(root, file)}:${text.slice(0, node.start).split(/\r\n|[\n\r\u2028\u2029]/).length}`);
            }
          },
        }).visit(source.program);
      }
    };
    scan(root);
    expect(violations).toEqual([]);
  });
});
