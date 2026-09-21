import { useEffect } from 'react';
import { useTranslation } from './i18n/index.js';
import { hydrateMermaid } from './mermaid.js';

/** Draws the mermaid diagrams inside a surface that mounts `renderNote` HTML, and keeps them on the active palette. */
export function useMermaidDiagrams(surface: { readonly current: HTMLElement | null; }, html: string) {
  const { t } = useTranslation();
  const errorLabel = t('mermaid.error');
  useEffect(() => surface.current ? hydrateMermaid(surface.current, { errorLabel }) : undefined, [surface, html, errorLabel]);
}
