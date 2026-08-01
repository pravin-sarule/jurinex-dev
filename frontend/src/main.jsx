import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/ClaudeAI.css';
import './styles/modern-ui.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { initFontPref } from './utils/fontPrefs.js';

// Apply the user's saved site-wide font (Settings → Appearance) before first paint.
initFontPref();

// pdfmake emits "Ran out of space in font private use area" for large fonts
// (NotoSansDevanagari has 65 K+ glyphs).  The warning is non-fatal — glyphs
// still render — but it floods the terminal.  Suppress it here at the root.
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('font private use area')) return;
  _origWarn(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>
);