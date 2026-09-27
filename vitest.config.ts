import { defineConfig } from 'vitest/config';

// Vitest empties imported CSS by default; the print export inlines KaTeX's stylesheet, so its tests read the real one.
export default defineConfig({ test: { css: { include: [/[\\/]katex[\\/]/] } } });
