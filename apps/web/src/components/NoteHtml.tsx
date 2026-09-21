import { useRef } from 'react';
import { useMermaidDiagrams } from '../lib/use-mermaid-diagrams.js';

/** Mounts `renderNote` HTML and draws its mermaid diagrams. */
export function NoteHtml({ html, className }: { html: string; className: string; }) {
  const surface = useRef<HTMLDivElement>(null);
  useMermaidDiagrams(surface, html);
  return <div ref={surface} className={className} data-markdown-view dangerouslySetInnerHTML={{ __html: html }} />;
}
