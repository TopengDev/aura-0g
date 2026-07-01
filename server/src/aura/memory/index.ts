// SERVER-ONLY. Persistent-memory v2 (dual-wall) — public surface.
//
// One mechanism (epoch-keyring + immutable AES-GCM segments), two layers (intrinsic / relationship), two
// transfer re-seal policies (re-seal-all / re-seal-none). Built on the shipped de-mock primitives
// (brain.ts AES-GCM, sealing.ts ECIES, pubkey.ts SIWE recovery). LOCAL backend — permanence (0G mainnet)
// is M5, out of scope. See ./README for the honesty ledger.
export * from "./types.js";
export * from "./local-store.js";
export * from "./segment.js";
export * from "./keyring.js";
export * from "./scrubber.js";
export * from "./reflect.js";
export * from "./core.js";
export * from "./transfer.js";
