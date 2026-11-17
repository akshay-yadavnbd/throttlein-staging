/**
 * Ambient module declarations for asset imports that TypeScript's
 * standalone type checker doesn't recognise by default.
 *
 * Next.js handles CSS and image imports at build time via its webpack
 * loaders, but `tsc --noEmit` (and the VS Code TS server) only sees
 * what's declared. Without these declarations, `import './globals.css'`
 * triggers TS2882: "Cannot find module or type declarations for
 * side-effect import of './globals.css'".
 *
 * Side-effect CSS imports (the only kind Next supports for global
 * styles) need this `declare module` block. Image imports already
 * resolve through `next/image-types/global` which is referenced
 * from next-env.d.ts.
 */
declare module '*.css';
declare module '*.scss';

declare module 'swiper/css';
declare module 'swiper/css/*';
