// No-op PostCSS config. Ponder bundles indexing code with Vite, and Vite searches UP the directory
// tree for a postcss config. The parent repo (the Next.js app) has a Tailwind-v4 postcss.config.mjs
// whose string-form plugin (`["@tailwindcss/postcss"]`) is valid for Next.js but NOT for Vite's
// PostCSS loader (Vite needs plugin instances, not bare strings), so it crashed Ponder's bundler.
// This local empty config stops the upward search here. Ponder processes no CSS, so a no-op is correct.
export default { plugins: [] };
