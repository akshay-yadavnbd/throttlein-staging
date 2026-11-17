import type { Config } from 'tailwindcss';
import { heroui } from '@heroui/react';

/**
 * THROTTLEIN palette
 *  - Lime  #BDFF00  → reserved for the logo wordmark ONLY
 *  - Black #141414  → primary CTA, text, dark surfaces
 *  - Cream #EFF1EA  → light page background
 *  - White #FFFFFF
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          lime: '#BDFF00',  // logo + active-nav accent on dark chrome
          black: '#141414',
          cream: '#EFF1EA',
          // Warm espresso — the panel's dark chrome (sidebar + header).
          // Deliberately NOT the pure #141414: per product decision the
          // chrome is "dark but not extremely dark black". Cream text on
          // it measures 13.82:1, lime 13.09:1.
          espresso: '#2B2119',
          white: '#FFFFFF',
          // Numeric scale = dark monochrome (used for borders, hover tints, etc.)
          50:  '#f6f6f7',
          100: '#e7e7e9',
          200: '#cfcfd2',
          300: '#a8a8ad',
          400: '#717177',
          500: '#3f3f44',
          600: '#27272a',
          700: '#1e1e21',
          800: '#18181b',
          900: '#141414',
        },
      },
      boxShadow: {
        glow: '0 0 0 2px rgba(20,20,20,0.12)',
      },
    },
  },
  darkMode: 'class',
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            background: '#EFF1EA',
            foreground: '#141414',
            focus: '#141414',
            primary: {
              50:  '#f6f6f7',
              100: '#e7e7e9',
              200: '#cfcfd2',
              300: '#a8a8ad',
              400: '#717177',
              500: '#3f3f44',
              600: '#27272a',
              700: '#1e1e21',
              800: '#18181b',
              900: '#141414',
              /**
               * Espresso, not #141414 — and specifically the nude theme's
               * `--accent` (#33291F), NOT the chrome colour.
               *
               * There are two similar espressos in play: the sidebar/header
               * chrome is brand-espresso #2B2119, while `--accent` is the
               * slightly lighter #33291F so a CTA lifts off that chrome.
               * `--accent` is what every migrated screen's button uses, so
               * that's the one `color="primary"` has to match — matching the
               * chrome instead just moved the mismatch rather than fixing it.
               *
               * Previously #141414, which made the ~46 buttons written as
               * `color="primary"` render a cooler, darker black than the
               * `bg-accent` buttons beside them.
               *
               * Only DEFAULT moves: the 50-900 scale stays neutral because
               * it's used for hover tints and borders, not fills.
               */
              DEFAULT: '#33291F',
              foreground: '#FFFFFF',
            },
            // UX audit T2: keep the v2 palette (still used by older admin pages)
            // in step with the v3 tokens in app/themes/nude.css.
            success: { DEFAULT: '#006A28', 500: '#006A28', 600: '#006A28', 700: '#005A22', foreground: '#FFFFFF' },
            warning: { DEFAULT: '#9D3E00', 500: '#9D3E00', 600: '#9D3E00', 700: '#873500', foreground: '#FFFFFF' },
            danger:  { DEFAULT: '#B30F09', 500: '#B30F09', 600: '#B30F09', 700: '#9A0D08', foreground: '#FFFFFF' },
          },
        },
        dark: {
          colors: {
            background: '#141414',
            foreground: '#EFF1EA',
            focus: '#FFFFFF',
            primary: {
              DEFAULT: '#FFFFFF',
              foreground: '#141414',
            },
          },
        },
      },
    }),
  ],
};
export default config;
