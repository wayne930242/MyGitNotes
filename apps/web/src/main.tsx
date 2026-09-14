import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { App } from './App.js';
import './index.css';
import './workspace.css';
import './ui-buttons.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
    </BrowserRouter>
  </React.StrictMode>
);
