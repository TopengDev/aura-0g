/**
 * Pre-hydration FOUC guard. Runs inline in <head> before first paint: reads the aura-theme
 * localStorage key (or the OS preference), stamps the .light/.dark class, and pins the theme
 * tokens with an `!important` <style> until ThemeProvider's effect re-stamps the class and lifts
 * it. Load-bearing for no-flash on both themes.
 *
 *   IMPORTANT: token values must match globals.css `@theme` and `html.dark`.
 */
import { THEME_STORAGE_KEY } from "./constants";

const LIGHT_TOKENS =
  [
    "--color-cream:#f9f8f6",
    "--color-cream-deep:#f0eee9",
    "--color-paper:#fcfbf9",
    "--color-cream-warm:#f3efe6",
    "--color-ink:#0e0d0a",
    "--color-ink-2:#46443d",
    "--color-ink-3:#8c887e",
    "--color-border:rgba(14,13,10,0.14)",
    "--color-border-strong:rgba(14,13,10,0.28)",
    "--color-accent:#2a3858",
    "--color-ok:#2f6b4f",
    "--color-warn:#9a3b2e",
    "--rgb-cream:249 248 246",
    "--rgb-ink:14 13 10",
    "--rgb-accent:42 56 88",
  ].join(" !important;") + " !important;";

const DARK_TOKENS =
  [
    "--color-cream:#0e0d0a",
    "--color-cream-deep:#161410",
    "--color-paper:#14120e",
    "--color-cream-warm:#1f1c14",
    "--color-ink:#efece3",
    "--color-ink-2:#a8a59e",
    "--color-ink-3:#928d82",
    "--color-border:rgba(239,236,227,0.1)",
    "--color-border-strong:rgba(239,236,227,0.22)",
    "--color-accent:#93a7d6",
    "--color-ok:#5dd5b6",
    "--color-warn:#e08a78",
    "--rgb-cream:14 13 10",
    "--rgb-ink:239 236 227",
    "--rgb-accent:147 167 214",
  ].join(" !important;") + " !important;";

const SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var explicit=s==='light'||s==='dark';var m=explicit?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;var ssrOk=r.classList.contains(m);if(!ssrOk){if(explicit){r.classList.remove(m==='dark'?'light':'dark');r.classList.add(m);}r.style.colorScheme=m;var tokens=m==='dark'?${JSON.stringify(DARK_TOKENS)}:${JSON.stringify(LIGHT_TOKENS)};var bg=m==='dark'?'#0e0d0a':'#f9f8f6';var fg=m==='dark'?'#efece3':'#0e0d0a';var st=document.createElement('style');st.id='__theme-init';st.textContent=':root{'+tokens+'}html,body{background-color:'+bg+' !important;color:'+fg+' !important;}';document.head.appendChild(st);}requestAnimationFrame(function(){r.setAttribute('data-theme-ready','1');});}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
