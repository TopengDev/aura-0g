#!/usr/bin/env bun
// Cross-compile the AURA CLI to a SINGLE STATIC BINARY per OS/arch (no Node/runtime dependency) + a
// node-targeted bundle for the npx fallback. One `bun run build` produces the whole release matrix that
// install.sh serves. Run from cli/:  bun run build.ts  [--targets=linux-x64,darwin-arm64]  [--npx-only]
import { $ } from "bun";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ENTRY = "src/index.ts";
const OUT = "dist";

// label -> bun --target triple. The label is what install.sh maps `uname` onto.
const TARGETS: Record<string, { triple: string; ext: string }> = {
  "linux-x64": { triple: "bun-linux-x64", ext: "" },
  "linux-arm64": { triple: "bun-linux-arm64", ext: "" },
  "darwin-x64": { triple: "bun-darwin-x64", ext: "" },
  "darwin-arm64": { triple: "bun-darwin-arm64", ext: "" },
  "windows-x64": { triple: "bun-windows-x64", ext: ".exe" },
};

const argv = process.argv.slice(2);
const npxOnly = argv.includes("--npx-only");
const only = argv.find((a) => a.startsWith("--targets="))?.split("=")[1]?.split(",");

async function sizeOf(path: string): Promise<string> {
  try {
    const s = await stat(path);
    return `${(s.size / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    return "?";
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  // 1. The npx/node fallback bundle (single JS file, shebang so `npx @aura/cli` runs it directly).
  console.log("→ building npx bundle (dist/index.js, --target=node)");
  await $`bun build ${ENTRY} --target=node --outfile ${OUT}/index.js --minify`.quiet();
  // The shebang MUST be byte 0 for node to strip it; bun --banner emits it after its own prelude, so
  // prepend it ourselves. node ignores a leading #! line; this makes `npx @aura/cli` executable.
  const bundled = readFileSync(`${OUT}/index.js`, "utf8").replace(/^#!.*\n/, "");
  await writeFile(`${OUT}/index.js`, `#!/usr/bin/env node\n${bundled}`);
  console.log(`  dist/index.js  ${await sizeOf(`${OUT}/index.js`)}`);

  if (npxOnly) return;

  // 2. The static binaries, one per target.
  const labels = (only ?? Object.keys(TARGETS)).filter((l) => TARGETS[l]);
  const checksums: string[] = [];
  for (const label of labels) {
    const { triple, ext } = TARGETS[label]!;
    const outName = `aura-${label}${ext}`;
    const outPath = `${OUT}/${outName}`;
    process.stdout.write(`→ compiling ${label}  (${triple}) ... `);
    const t0 = performance.now();
    try {
      await $`bun build ${ENTRY} --compile --target=${triple} --outfile ${outPath} --minify`.quiet();
      // gzip the binary for hosting/download (raw binaries are 60-110MB; gz ~ a third). install.sh
      // downloads the .gz, verifies its sha256, then gunzips. SHA256SUMS is over the DOWNLOADED .gz.
      const raw = new Uint8Array(readFileSync(outPath));
      const gz = Bun.gzipSync(raw, { level: 9 });
      await writeFile(`${outPath}.gz`, gz);
      const hash = createHash("sha256").update(new Uint8Array(gz)).digest("hex");
      checksums.push(`${hash}  ${outName}.gz`);
      console.log(`ok  ${await sizeOf(outPath)} -> ${await sizeOf(`${outPath}.gz`)} gz  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.log(`FAILED`);
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  }

  if (checksums.length) {
    await writeFile(`${OUT}/SHA256SUMS`, checksums.join("\n") + "\n");
    console.log(`\n✔ ${checksums.length} binaries + dist/SHA256SUMS written to ${OUT}/`);
  }
}

main();
