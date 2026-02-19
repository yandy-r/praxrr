/**
 * Theme store for light/dark mode
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark';

function createThemeStore() {
  // Initialize theme from localStorage or system preference
  let initialTheme: Theme = 'dark';
  if (browser) {
    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        initialTheme = stored;
      } else {
        initialTheme = globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {
      initialTheme = globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  }

  const { subscribe, update } = writable<Theme>(initialTheme);

  // Apply theme on initialization
  if (browser) {
    applyTheme(initialTheme);
  }

  function applyTheme(newTheme: Theme) {
    if (browser) {
      // Use View Transitions API if available for smooth theme changes
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(newTheme);
        });
      } else {
        // Fallback for browsers without View Transitions API
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(newTheme);
      }
    }
  }

  function toggle() {
    update((current) => {
      const newTheme = current === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
      if (browser) {
        try {
          localStorage.setItem('theme', newTheme);
        } catch {
          // localStorage unavailable (private browsing, storage full, etc.)
        }
      }
      return newTheme;
    });
  }

  return {
    subscribe,
    toggle,
  };
}

export const themeStore = createThemeStore();
