import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Bundled (offline-safe, CSP 'self'); the dynamic subset only loads the glyph ranges a page uses.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
