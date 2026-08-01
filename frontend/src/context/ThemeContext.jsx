import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * Site-wide theme (Settings → Appearance → Theme).
 *
 * Three themes: light (default), dark, sepia. The provider stamps
 * `data-theme` on <html>; the actual restyling lives in index.css, which
 * applies a root-level filter — this themes the ENTIRE app (including its
 * thousands of hardcoded light-mode colors) without touching each component.
 * Persisted per browser under the pre-existing localStorage key 'theme'.
 */

export const THEME_OPTIONS = [
  { id: 'light', label: 'Light', note: 'System default theme' },
  { id: 'dark', label: 'Dark', note: 'Warm dark, Claude-style' },
  { id: 'sepia', label: 'Sepia', note: 'Warm, paper-like reading' },
];

const VALID_THEMES = THEME_OPTIONS.map((t) => t.id);

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return VALID_THEMES.includes(saved) ? saved : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setThemeDirect = (newTheme) => {
    setTheme(VALID_THEMES.includes(newTheme) ? newTheme : 'light');
  };

  // Cycles light → dark → sepia → light (kept for legacy callers).
  const toggleTheme = () => {
    setTheme((prev) => {
      const idx = VALID_THEMES.indexOf(prev);
      return VALID_THEMES[(idx + 1) % VALID_THEMES.length];
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeDirect, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
