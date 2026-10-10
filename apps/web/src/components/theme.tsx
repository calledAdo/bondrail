'use client';
import { ThemeProvider as NextThemes, useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

/** Dark by default (the DeFi look); the toggle stores the visitor's choice. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme === 'dark';
  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="inline-flex size-9 items-center justify-center rounded-lg text-foreground/60 transition-colors duration-300 hover:bg-foreground/5 hover:text-foreground"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
