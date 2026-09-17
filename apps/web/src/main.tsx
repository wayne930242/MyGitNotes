import React from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handleNoteQueryError } from './lib/use-note-queries.js';
import { App } from './App.js';
import { PanelProvider } from './lib/panel-context.js';
import './index.css';
import './workspace.css';
import './ui-buttons.css';
import './directives.css';

// Note answers are addressed by workspace revision, so they never go stale on their own; a
// failed query surfaces its error instead of retrying behind the user's back.
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => handleNoteQueryError(error, query) }),
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
    <NuqsAdapter>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PanelProvider>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/notes" element={<App />} />
        <Route path="/index.html" element={<App />} />
        <Route path="/notebooks" element={<App />} />
        <Route path="/notebooks/:notebook" element={<App />} />
        <Route path="/notebooks/:notebook/folders/*" element={<App />} />
        <Route path="/notebooks/:notebook/notes/*" element={<App />} />
        <Route path="/assets" element={<App />} />
        <Route path="/agent" element={<App />} />
        <Route path="/settings" element={<App />} />
        <Route path="*" element={<App />} />
      </Routes>
      </PanelProvider>
    </BrowserRouter>
    </NuqsAdapter>
    </QueryClientProvider>
  </React.StrictMode>
);
