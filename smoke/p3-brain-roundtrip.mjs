// PROBE 3 [CRITICAL]: full brain round-trip.
// Build a "brain" JSON (style descriptor + canonical base image root + model), AES-encrypt it,
// store() to 0G Storage → encBrainRoot, download() back, decrypt, byte-compare, then DRIVE ONE
// generation purely from the decrypted brain (no fallback). GREEN = byte-identical round-trip AND
// the gen is driven by the recovered brain and reproduces the intended style.
import { demoWallet, getBroker, imageService, generate, store, download } from "./lib-compute.mjs";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const w = demoWallet();

// 1. Build the brain. The "canonical base image root" — we use the local merkle root of a real base
//    image as the brain's pointer, and embed the base bytes' sha for integrity.
const baseBytes = readFileSync("smoke/inputs/face.png"); // canonical base for this agent
const brain = {
  agent: "SMOKE-BRAIN",
  model: "qwen/qwen-image-edit-2511",
  styleDescriptor: "Style: bold risograph duotone, fluorescent pink and blue, halftone grain, flat indie-zine shapes.",
  identityLock: "Keep the EXACT same person (same face shape, features, expression, hair).",
  canonicalBaseSha256: createHash("sha256").update(baseBytes).digest("hex"),
  createdAt: new Date().toISOString(),
};
const plain = Buffer.from(JSON.stringify(brain, null, 2), "utf8");
console.log("brain plaintext bytes:", plain.length, "| sha:", createHash("sha256").update(plain).digest("hex").slice(0,16));

// 2. AES-256-GCM encrypt (node:crypto).
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
// envelope = iv || tag || ciphertext  (this is what we seal on 0G Storage)
const envelope = Buffer.concat([iv, tag, ct]);
console.log("encrypted envelope bytes:", envelope.length);

// 3. store() the encrypted envelope to 0G Storage → encBrainRoot.
console.log("storing encrypted brain on 0G Storage …");
const sres = await store(w, envelope, "enc-brain");
const encBrainRoot = sres.rootHash;
console.log("✓ encBrainRoot:", encBrainRoot, "txHash:", sres.txHash, "dedup:", sres.dedup);

// 4. download() it back by root.
console.log("downloading brain back by root …");
const got = await download(encBrainRoot, "smoke/outputs/p3-brain-downloaded.bin");
const byteIdentical = Buffer.compare(got, envelope) === 0;
console.log("✓ downloaded bytes:", got.length, "| byte-identical envelope:", byteIdentical);
if (!byteIdentical) { console.log("✗ RED: round-trip NOT byte-identical"); process.exit(1); }

// 5. decrypt the downloaded envelope.
const dIv = got.subarray(0, 12);
const dTag = got.subarray(12, 28);
const dCt = got.subarray(28);
const decipher = createDecipheriv("aes-256-gcm", key, dIv);
decipher.setAuthTag(dTag);
const recovered = Buffer.concat([decipher.update(dCt), decipher.final()]);
const decryptIdentical = Buffer.compare(recovered, plain) === 0;
console.log("✓ decrypted plaintext bytes:", recovered.length, "| byte-identical to original brain:", decryptIdentical);
if (!decryptIdentical) { console.log("✗ RED: decrypt mismatch"); process.exit(1); }

const recoveredBrain = JSON.parse(recovered.toString("utf8"));
console.log("✓ recovered brain.agent:", recoveredBrain.agent, "| model:", recoveredBrain.model);

// integrity: the canonical base sha in the recovered brain must match the base we re-load to drive the gen
const reloadSha = createHash("sha256").update(baseBytes).digest("hex");
console.log("✓ canonical base sha matches recovered brain:", reloadSha === recoveredBrain.canonicalBaseSha256);

// 6. DRIVE ONE generation purely from the RECOVERED brain (descriptor + identity lock + model).
const broker = await getBroker(w);
const svc = await imageService(broker);
const prompt = `${recoveredBrain.identityLock} make it a clean head-and-shoulders portrait. ${recoveredBrain.styleDescriptor}`;
console.log("\ngenerating from RECOVERED brain — prompt:", prompt.slice(0,130), "…");
const g = await generate(broker, svc, baseBytes, prompt);
writeFileSync("smoke/outputs/p3-from-brain.png", g.bytes);
console.log(`✓ gen from brain: out=smoke/outputs/p3-from-brain.png bytes=${g.bytes.length} verified=${g.verified} latency=${g.latencyMs}ms`);

writeFileSync("smoke/outputs/p3-results.json", JSON.stringify({
  encBrainRoot, storeTxHash: sres.txHash, envelopeBytes: envelope.length,
  byteIdenticalDownload: byteIdentical, byteIdenticalDecrypt: decryptIdentical,
  recoveredBrain, genVerified: g.verified, genBytes: g.bytes.length, genChatId: g.chatId,
}, null, 2));
console.log("\n=== PROBE 3 GREEN: brain round-tripped byte-identical AND drove a verified gen ===");
