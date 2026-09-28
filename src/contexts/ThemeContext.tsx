import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Relative luminance per WCAG 2.1, used to keep text on the accent readable. */
const channelLuminance = (value: number): number => {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const contrastRatio = (hex: string): number => {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;

  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body;

  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return 0;

  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
};

/** Pick black or white text for the accent, whichever has more contrast. */
export const readableForegroundFor = (accent: string): string =>
  contrastRatio(accent) > 0.45 ? '#0b0b0c' : '#ffffff';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hasStorage =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = hasStorage ? localStorage.getItem('theme') : null;
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    return (hasStorage ? localStorage.getItem('accentColor') : null) || '#10b981';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    if (hasStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem('theme', themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', accentColor);
    root.style.setProperty('--primary-foreground', readableForegroundFor(accentColor));
    if (hasStorage && typeof localStorage.setItem === 'function') {
      localStorage.setItem('accentColor', accentColor);
    }
  }, [accentColor]);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeAccent = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeAccent must be used within a ThemeProvider');
  }
  return context;
};
