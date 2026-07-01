// SERVER-ONLY. Persistent-memory v2 — the two-layer ("dual-wall") type model.
//
// Grounded in the validated design (notes/aura-memory-design-2026-06-29/MEMORY-DESIGN-owner-safety.md §2
// and notes/aura-research-memory-v2-2026-06-30/report.md). ONE mechanism (the spike's epoch-keyring),
// split into TWO layers with TWO transfer re-seal policies:
//   - Layer 1 INTRINSIC      — the agent's owner-AGNOSTIC self (style/skills/taste/public catalog).
//                              Spans ALL epochs; on sale, EVERY past epoch key re-seals to the buyer.
//   - Layer 2 RELATIONSHIP   — the owner-SPECIFIC bond (chat/prefs/identity). Current epoch ONLY;
//                              on sale, NO prior epoch key transfers (the dual wall, by key custody).
//
// Honesty ledger (kept precise on purpose): L2 cross-owner privacy is CRYPTOGRAPHIC (a cipher);
// L1 owner-agnosticism is STRUCTURAL (the membrane + schema + scrubber, never provably complete, RS1).

export type Epoch = number;
export type Layer = "intrinsic" | "relationship";

/** Day-granularity / epoch-relative ONLY — no fine timestamp or timezone (kills the H1 side-channel). */
export type CoarseTs = string;

/** 0x-hex of an ECIES-sealed 32-byte epoch key (what the manifest keyring stores, per current owner). */
export type SealedKeyHex = `0x${string}`;

// ── Layer 1 INTRINSIC records — owner-free BY SCHEMA (no field anywhere names an owner) ──

/** Structured evolution of brain.ts BrainPlain's style fields — structured, not prose => minimal leak. */
export type StyleVec = { descriptor: string; identityLock: string; negative: string; basePolicy: string };

/** A string that has PASSED the scrubber (scrubber.ts). Nominal type — enforced at the writer, not by TS. */
export type ScrubbedText = string;

export type IntrinsicRecord =
  | { kind: "style_delta"; before: StyleVec; after: StyleVec; note?: ScrubbedText; ts: CoarseTs }
  | { kind: "skill"; tag: string; proficiency: number; ts: CoarseTs }
  | { kind: "taste"; descriptor: ScrubbedText; ts: CoarseTs } // abstract + de-attributed
  | { kind: "work_public"; workRoot: string; outputNftId?: string; techniqueTags: string[]; ts: CoarseTs };

// ── Layer 2 RELATIONSHIP records — role-tokenized, PII contained, never transfers ──

export type OwnerIdentityVault = {
  // The ONE place a literal owner identity is ever written. Sealed to THIS owner, THIS epoch only.
  displayName?: string;
  walletAddr: string; // == the on-chain owner; pseudonymous, already public
  handle?: string;
  [k: string]: unknown; // anything the owner volunteers
};

export type RelationshipRecord =
  | { kind: "chat"; turns: { role: "owner" | "agent"; text: string }[]; ts: string } // text MAY hold PII
  | { kind: "preference"; subject: "<<OWNER>>"; pref: string; ts: string }
  | { kind: "rapport"; tone: string; runningContext: string; insideRefs: string[]; ts: string }
  | { kind: "owner_identity_vault"; vault: OwnerIdentityVault; ts: string };

export type MemoryRecord = IntrinsicRecord | RelationshipRecord;

// ── Manifest (per CURRENT owner): two sub-manifests, one mechanism ──

/** A pointer to an immutable, content-addressed, AES-GCM-sealed segment in the backend store. */
export type SegRef = {
  id: string; // unique segment id (agentId/layer/epoch/seq)
  layer: Layer;
  epoch: Epoch;
  root: string; // content root in the backend store (== sha256 of the sealed envelope here)
  dataHash: string; // sha256 of the sealed envelope (tamper-evidence; mirrors oracle.ts dataHashOf)
  count: number; // number of records inside (coarse metadata only)
};

export type Manifest = {
  agentId: string;
  currentEpoch: Epoch;
  owner: string; // current owner address (lowercased)
  intrinsic: {
    segments: SegRef[]; // ALL epochs (history transfers)
    keyring: Record<Epoch, SealedKeyHex>; // ALL intrinsic epoch keys, sealed to the CURRENT owner
  };
  relationship: {
    segments: SegRef[]; // ONLY the current owner's epoch(s) are listed (relationship resets on sale)
    keyring: Record<Epoch, SealedKeyHex>; // ONLY the current owner's epoch key(s)
  };
};
