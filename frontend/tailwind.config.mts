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
          lime: '#BDFF00',  // logo-only
          black: '#141414',
          cream: '#EFF1EA',
          // Warm espresso — the SELLER DASHBOARD's chrome (sidebar +
          // header), mirroring the admin panel so both operator-facing
          // surfaces read as one system. Deliberately NOT used on the
          // public storefront, which keeps #141414.
          espresso: '#2B2119',
          white: '#FFFFFF',
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
      fontFamily: {
        // Poppins is loaded as a secondary face in app/layout.tsx and
        // exposed via the `--font-poppins` CSS variable. Adding it to
        // the theme so `font-poppins` works as a utility class — the
        // 404 page (and any future Figma-derived component) opts into
        // Poppins by tagging individual elements rather than scoping
        // a whole section via `.blog-detail`.
        poppins: ['var(--font-poppins)', 'Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
              DEFAULT: '#141414',
              foreground: '#FFFFFF',
            },
            // UX audit T2: HeroUI v2's stock success/warning/danger text
            // (used by `variant="flat"` chips as text-<colour>-700 on a
            // 20% tint) measured 4.4:1 on the cream surface. These match
            // the v3 tokens in app/themes/nude.css so a chip reads the
            // same in both apps and clears 4.6:1 in the worst case.
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
