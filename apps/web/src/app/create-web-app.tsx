import React from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handleNoteQueryError } from '../lib/use-note-queries.js';
import { App } from '../App.js';
import { PanelProvider } from '../lib/panel-context.js';
import '../index.css';
import '../workspace.css';
import '../ui-buttons.css';
import '../mermaid.css';
import 'katex/dist/katex.min.css';
import '../math.css';
import '../directives/general-containers.css';
import '../directives/character-stat-blocks.css';
import '../directives/document-cards.css';
import '../directives/parallel-quotes.css';
import '../directives/embedded-cards.css';
import '../directives/presentation.css';
import '../directives/inline.css';
import '../directives/mdx-components.css';
import '../directives/live-editor-toolbar.css';
import '../directives/mobile-adaptations.css';

import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';

export interface WebAppOptions {
  /** What another edition adds; the community edition passes none. */
  features?: readonly WebFeature[];
}

/** The whole web app: data, routing and panels, with any edition features registered. */
export function WebApp({ features = [] }: WebAppOptions) {
  // Note answers are addressed by workspace revision, so they never go stale on their own; a
  // failed query surfaces its error instead of retrying behind the user's back.
  const [queryClient] = React.useState(() => new QueryClient({ queryCache: new QueryCache({ onError: (error, query) => handleNoteQueryError(error, query) }), defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <WebFeaturesProvider features={features}>
        <NuqsAdapter>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PanelProvider>
              <Routes>
                <Route path='/' element={<App />} />
                <Route path='/notes' element={<App />} />
                <Route path='/index.html' element={<App />} />
                <Route path='/notebooks' element={<App />} />
                <Route path='/notebooks/:notebook' element={<App />} />
                <Route path='/notebooks/:notebook/folders/*' element={<App />} />
                <Route path='/notebooks/:notebook/notes/*' element={<App />} />
                <Route path='/assets' element={<App />} />
                <Route path='/agent' element={<App />} />
                <Route path='/settings' element={<App />} />
                {features.flatMap(feature => feature.routes ?? []).map(route => <Route key={route.path} path={route.path} element={route.element} />)}
                <Route path='*' element={<App />} />
              </Routes>
            </PanelProvider>
          </BrowserRouter>
        </NuqsAdapter>
      </WebFeaturesProvider>
    </QueryClientProvider>
  );
}

/** Renders the web app into `root`; an edition's entry calls it with its features. */
export function createWebApp(root: HTMLElement, options: WebAppOptions = {}) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WebApp {...options} />
    </React.StrictMode>,
  );
}
