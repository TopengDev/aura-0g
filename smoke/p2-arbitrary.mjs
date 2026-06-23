// PROBE 2 [CRITICAL]: arbitrary user reference image → on-style, character-consistent generation.
// For each varied input, feed it as the edit base + a style descriptor + a "keep the EXACT same
// subject, change ONLY <trait>" clause. GREEN = on-style AND subject identity holds across the trait change.
import { demoWallet, getBroker, imageService, generate } from "./lib-compute.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const STYLE = "Style: risograph duotone, fluorescent pink and blue, bold halftone grain, flat indie-zine shapes.";

// One trait change per input type. The generalized prompt = identity-lock clause + trait + style.
const CASES = [
  { in: "face.png",     subject: "the EXACT same person (same face shape, features, expression, hair)", trait: "add round eyeglasses" },
  { in: "logo.png",     subject: "the EXACT same logo mark (same shapes, composition, proportions)",    trait: "change the background to deep navy" },
  { in: "sketch.png",   subject: "the EXACT same sketched character (same linework, pose, proportions)",  trait: "give it a small hat" },
  { in: "busy.png",     subject: "the EXACT same scene and all its elements (same layout, same objects)", trait: "shift it to a nighttime mood" },
  { in: "abstract.png", subject: "the EXACT same abstract composition (same rings, same gradient layout)", trait: "add a thin gold outline accent" },
];

const w = demoWallet();
const broker = await getBroker(w);
const svc = await imageService(broker);
console.log("svc model:", svc.meta.model, "| provider:", svc.provider);

const results = [];
for (const c of CASES) {
  const base = readFileSync(`smoke/inputs/${c.in}`);
  const prompt = `Keep ${c.subject}. ${c.trait}. ${STYLE}`;
  process.stdout.write(`\n[${c.in}] generating (trait: ${c.trait}) …\n  prompt: ${prompt.slice(0,120)}…\n`);
  try {
    const g = await generate(broker, svc, base, prompt);
    const out = `smoke/outputs/p2-${c.in}`;
    writeFileSync(out, g.bytes);
    const rec = { input: c.in, trait: c.trait, out, bytes: g.bytes.length, verified: g.verified, chatId: g.chatId, latencyMs: g.latencyMs, teeSigner: g.teeSigner };
    results.push(rec);
    console.log(`  ✓ out=${out} bytes=${g.bytes.length} verified=${g.verified} latency=${g.latencyMs}ms`);
  } catch (e) {
    const rec = { input: c.in, trait: c.trait, error: String(e?.message).slice(0,200) };
    results.push(rec);
    console.log(`  ✗ FAILED: ${rec.error}`);
  }
}
writeFileSync("smoke/outputs/p2-results.json", JSON.stringify(results, null, 2));
console.log("\n=== PROBE 2 SUMMARY ===");
for (const r of results) console.log(r.error ? `✗ ${r.input}: ${r.error}` : `✓ ${r.input}: ${r.bytes}b verified=${r.verified}`);
