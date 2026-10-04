import type { ComponentProps } from 'react';
import { useCompilations } from '../lib/use-compilation.js';
import { GraphPage } from './GraphPage.js';

/** The Graph tab: the notebook graph, with every compilation of the notebook as a lane to overlay or create. */
export function NotebookGraphPage({ notebookId, ...props }: Omit<ComponentProps<typeof GraphPage>, 'screen' | 'lane'> & { notebookId: string; }) {
  const compilations = useCompilations(notebookId, props.notebooks);
  return <GraphPage {...props} screen={compilations} />;
}
