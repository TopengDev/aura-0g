import { demoWallet, getBroker, imageService, sdk, indexer } from "./lib-compute.mjs";
console.log("=== UNBUNDLED NODE: createRequire(broker) + dynamic import(storage SDK) ===");
const w = demoWallet();
console.log("wallet:", w.address);

// broker via createRequire
const t0 = Date.now();
const broker = await getBroker(w);
console.log("✓ compute broker loaded via createRequire (", Date.now()-t0, "ms )");

// storage SDK via dynamic import
const s = await sdk();
console.log("✓ storage SDK loaded via dynamic import — exports:", Object.keys(s).filter(k=>/Indexer|MemData|defaultUpload/.test(k)).join(","));
const idx = await indexer();
console.log("✓ Indexer constructed");

// TEE image service availability (precondition for gen probes)
const svc = await imageService(broker);
console.log("✓ TEE image service FOUND");
console.log("   provider:", svc.provider);
console.log("   model:", svc.meta.model);
console.log("   endpoint:", svc.meta.endpoint);
console.log("   verifiability:", svc.verifiability);
console.log("   teeSigner:", svc.teeSigner);

// ledger / session check (probe 8: ~24h gasless session signature)
try {
  const led = await broker.ledger.getLedger();
  console.log("   ledger total/locked:", led?.totalBalance?.toString?.() ?? led, "/", led?.locked?.toString?.() ?? "");
} catch(e) { console.log("   ledger read note:", String(e?.message).slice(0,80)); }
