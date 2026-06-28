/**
 * Pre-hydration motion-tier flag. Runs inline in <head> before first paint and stamps `html.low-motion`
 * on devices that should get the lighter motion profile: touch / coarse pointers (phones + tablets), an
 * explicit reduced-motion preference, or low memory / few cores. Stamping pre-hydration (on <html>, which
 * already carries suppressHydrationWarning) lets globals.css neutralize the per-frame blur reveals from
 * the very first paint, with NO hydration mismatch -- the framer initial state is unchanged on both server
 * and client; CSS only overrides the rendered filter. SAME look at rest, lower per-frame cost.
 */
const SCRIPT = `(function(){try{var r=document.documentElement;var mm=function(q){try{return matchMedia(q).matches}catch(e){return false}};var reduced=mm('(prefers-reduced-motion: reduce)');var coarse=mm('(pointer: coarse)');var mem=navigator.deviceMemory;var cores=navigator.hardwareConcurrency;var low=reduced||coarse||(typeof mem==='number'&&mem<=4)||(typeof cores==='number'&&cores<=4);if(low)r.classList.add('low-motion');}catch(e){}})();`;

export function MotionTierScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
