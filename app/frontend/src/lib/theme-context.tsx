import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Tema fixo em 'light' apos redesign para paleta unica cream/navy/terracotta.
  // O toggle foi removido; mantemos o provider para nao quebrar os consumidores de t(dark, light, theme).
  const theme: Theme = 'light';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Limpa qualquer preferencia antiga salva
    try { localStorage.removeItem('ecu-sim-theme'); } catch { /* noop */ }
  }, []);

  const toggleTheme = () => {
    /* no-op: tema unico */
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// ============================================================
// Theme-aware CSS class helpers
// ============================================================
export function t(dark: string, light: string, theme: Theme): string {
  return theme === 'dark' ? dark : light;
}