// Rewrite the ROOT_TO_FILE map in web/src/app/images/[root]/route.ts from the ledger.
// Preserves any pre-existing entries (tokenId 5,6) and adds every newly-minted root -> outputs/<file>.
// Only touches the ROOT_TO_FILE const block; nothing else in the file.
import { readFileSync, writeFileSync } from "node:fs";

const ROUTE = "web/src/app/images/[root]/route.ts";
const LEDGER = "smoke/showcase/ledger.json";

const src = readFileSync(ROUTE, "utf8");
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));

// Pull existing entries from the current map (so we never drop the seeded tokenId 5/6 bytes).
const mapMatch = src.match(/const ROOT_TO_FILE: Record<string, string> = \{([\s\S]*?)\};/);
if (!mapMatch) { console.error("ROOT_TO_FILE block not found"); process.exit(1); }
const existing = {};
for (const m of mapMatch[1].matchAll(/"(0x[0-9a-fA-F]+)":\s*"([^"]+)"/g)) existing[m[1]] = m[2];

// Add minted roots from the ledger.
let added = 0;
for (const p of ledger.pieces) {
  if (p.status !== "minted" || !p.imageRoot?.startsWith("0x") || !p.file) continue;
  if (!existing[p.imageRoot]) added++;
  existing[p.imageRoot] = `outputs/${p.file}`;
}

const lines = Object.entries(existing).map(([root, file]) => `  "${root}": "${file}",`).join("\n");
const block = `const ROOT_TO_FILE: Record<string, string> = {\n${lines}\n};`;
const out = src.replace(/const ROOT_TO_FILE: Record<string, string> = \{[\s\S]*?\};/, block);
writeFileSync(ROUTE, out);
console.log(`ROOT_TO_FILE updated: ${Object.keys(existing).length} total entries (${added} new). File: ${ROUTE}`);
for (const [root, file] of Object.entries(existing)) console.log(`  ${root.slice(0, 20)} -> ${file}`);
