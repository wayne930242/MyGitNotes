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
// CSS named colours (CSS Color 4).
const named = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';
const rules = [
  ['hex colour', /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g],
  ['colour function', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g],
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
