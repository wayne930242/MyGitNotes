// Fails when a literal colour appears in apps/web outside the palette definitions.
// Every UI colour must resolve from a theme token (see apps/web/src/lib/themes.ts).
import fs from 'node:fs';
import path from 'node:path';

const roots = ['apps/web/src', 'apps/web/index.html', 'apps/web/tailwind.config.js'];
const palette = 'apps/web/src/lib/palettes.ts';
/** Unavoidable literals, each with its reason. */
const exceptions = [
  { file: 'apps/web/index.html', pattern: /<meta name="theme-color" content="#284d43"/, reason: 'Brand colour for the browser chrome, read before any stylesheet or theme loads.' },
];
const tests = /\.test\.[jt]sx?$/;

const hues = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const named = 'white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|maroon|olive|teal|aqua|lime|fuchsia|brown|gold|indigo|violet';
const rules = [
  ['hex colour', /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g],
  ['colour function', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g],
  ['Tailwind palette class', new RegExp(`(?<![\\w-])(?:[\\w\\[\\]&:-]+:)?(?:text|bg|border(?:-[trblxy])?|ring(?:-offset)?|fill|stroke|from|to|via|outline|divide|shadow|decoration|placeholder|accent|caret)-(?:${hues})(?:-\\d{2,3})?(?:/[\\d.\\[\\]]+)?(?![\\w-])`, 'g')],
  ['CodeMirror default highlight style (fixed colours)', /\bdefaultHighlightStyle\b/g],
  ['named colour', new RegExp(`(?:[:,(]\\s*|=\\s*["']|:\\s*["'])(?:${named})(?=\\s*(?:[;,)"'}!]|$))`, 'gim')],
];

const files = roots.flatMap(function walk(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) return fs.readdirSync(entry).flatMap(child => walk(path.posix.join(entry, child)));
  return /\.(?:css|html|[cm]?[jt]sx?)$/.test(entry) ? [entry] : [];
});

const errors = [];
for (const file of files) {
  if (file === palette || tests.test(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (exceptions.some(exception => exception.file === file && exception.pattern.test(line))) return;
    for (const [kind, pattern] of rules) {
      for (const match of line.matchAll(pattern)) errors.push(`${file}:${index + 1}: ${kind} '${match[0].trim()}'`);
    }
  });
}

if (errors.length) {
  console.error(`Hard-coded colours outside ${palette}; use a theme token instead:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`No hard-coded colours in ${files.length} apps/web files outside the palette definitions.`);
