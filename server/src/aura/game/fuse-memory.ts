// SERVER-ONLY. FUSION MEMORY: the child INHERITS Layer-1 (intrinsic, owner-agnostic self/style) BLENDED from
// BOTH parents, and RESETS Layer-2 (relationship, owner-specific) to empty. This is the locked design
// (Christopher 2026-07-05): a fused child carries forward the artistic SELF of its lineage (style, skills,
// taste, public body of work - all owner-free) but starts a CLEAN relationship with its fuser (no inherited
// chat/prefs/identity from either parent's owners).
//
// It reuses the dual-wall memory module VERBATIM: L1 is the owner-agnostic layer whose keys are server-escrowed
// (memory/core.ts) - so the server reads BOTH parents' L1 via their escrow and re-seals the blend to the fuser;
// L2 is the no-escrow relationship layer that memory/transfer.ts already RESETS on an ownership change. Fusion
// is exactly a "new owner starts fresh L2" event for a brand-new agent, so the child is created with a fresh
// empty L2 sealed to the fuser (MemoryService.create) - the reset falls out of the same mechanism as a sale.
//
// The blend is a UNION of both parents' owner-agnostic intrinsic records (skills merged by averaging shared
// proficiencies; style/taste/work de-duplicated) plus ONE fused style_delta that records the genome-derived
// blended style as the child's founding intrinsic self. It is testable in isolation with the local backend.
import { MemoryService, readLayer } from "../memory/core.js";
import type { SegmentBackend } from "../memory/local-store.js";
import { openSegment } from "../memory/segment.js";
import type { IntrinsicRecord, CoarseTs, StyleVec } from "../memory/types.js";

/**
 * Read a MemoryService's Layer-1 intrinsic records via the SERVER ESCROW (the owner-agnostic keys the server
 * holds to re-seal on sale), so a blend needs no owner private key. This is the read-side twin of
 * appendIntrinsic (which writes with the same escrow key). A segment whose epoch key is absent from escrow
 * contributes nothing (the wall, in escrow form).
 */
export async function readIntrinsicViaEscrow(service: MemoryService, backend: SegmentBackend): Promise<IntrinsicRecord[]> {
  const out: IntrinsicRecord[] = [];
  for (const ref of service.manifest.intrinsic.segments) {
    const key = service.intrinsicEscrow.get(ref.epoch);
    if (!key) continue; // no escrow key for this epoch -> unreadable server-side
    const env = await backend.download(ref.root);
    try {
      const recs = openSegment(key, env) as IntrinsicRecord[];
      out.push(...recs);
    } catch {
      /* opaque without the key - skip */
    }
  }
  return out;
}

/**
 * Blend two parents' owner-agnostic L1 record streams + the child's genome-derived style into the child's
 * founding intrinsic memory. Pure (no I/O). Order:
 *   1. a founding `style_delta` recording the genome-derived blended style (the child's new self).
 *   2. all skills from BOTH parents, MERGED by tag (shared tags average their proficiency).
 *   3. all tastes from both parents, de-duplicated by descriptor.
 *   4. all public works from both parents, de-duplicated by workRoot.
 *   5. all prior style_deltas from both parents (the inherited style-evolution history), de-duplicated.
 */
export function blendIntrinsic(
  parentAL1: IntrinsicRecord[],
  parentBL1: IntrinsicRecord[],
  childStyle: StyleVec,
  ts: CoarseTs,
): IntrinsicRecord[] {
  const all = [...parentAL1, ...parentBL1];
  const blended: IntrinsicRecord[] = [];

  // 1. founding fused style_delta. before = a parent's most-recent style if any (else the child's own), after
  //    = the genome-derived blended style. This anchors the fusion as an intrinsic self-change in L1.
  const priorStyles = all.filter((r): r is Extract<IntrinsicRecord, { kind: "style_delta" }> => r.kind === "style_delta");
  const before: StyleVec = priorStyles.length ? priorStyles[priorStyles.length - 1]!.after : childStyle;
  blended.push({ kind: "style_delta", before, after: childStyle, note: "fused: genome-blended style from both parents", ts });

  // 2. skills merged by tag (average shared proficiencies; keep the highest ts is irrelevant - L1 is coarse).
  const skillByTag = new Map<string, number[]>();
  for (const r of all) {
    if (r.kind === "skill") {
      const arr = skillByTag.get(r.tag) ?? [];
      arr.push(r.proficiency);
      skillByTag.set(r.tag, arr);
    }
  }
  for (const [tag, profs] of skillByTag) {
    const avg = profs.reduce((a, b) => a + b, 0) / profs.length;
    blended.push({ kind: "skill", tag, proficiency: avg, ts });
  }

  // 3. tastes, de-duplicated by descriptor.
  const seenTaste = new Set<string>();
  for (const r of all) {
    if (r.kind === "taste" && !seenTaste.has(r.descriptor)) {
      seenTaste.add(r.descriptor);
      blended.push({ kind: "taste", descriptor: r.descriptor, ts });
    }
  }

  // 4. public works, de-duplicated by workRoot.
  const seenWork = new Set<string>();
  for (const r of all) {
    if (r.kind === "work_public" && !seenWork.has(r.workRoot)) {
      seenWork.add(r.workRoot);
      blended.push({ kind: "work_public", workRoot: r.workRoot, outputNftId: r.outputNftId, techniqueTags: r.techniqueTags, ts });
    }
  }

  // 5. inherited prior style_deltas (the lineage's style-evolution history), de-duplicated by after.descriptor.
  const seenDelta = new Set<string>();
  for (const r of priorStyles) {
    const key = `${r.before.descriptor}=>${r.after.descriptor}`;
    if (!seenDelta.has(key)) {
      seenDelta.add(key);
      blended.push({ kind: "style_delta", before: r.before, after: r.after, note: r.note, ts });
    }
  }

  return blended;
}

export interface FuseChildMemoryInput {
  childAgentId: string; // the minted child agentId (string form the memory module uses)
  fuserAddr: string; // the fuser (child's owner) address
  fuserPubkey: string; // the fuser's recovered secp256k1 pubkey (for sealing the child's keys)
  parentAL1: IntrinsicRecord[]; // parent A's owner-agnostic L1 (read via escrow)
  parentBL1: IntrinsicRecord[]; // parent B's owner-agnostic L1 (read via escrow)
  childStyle: StyleVec; // the genome-derived blended style (from genome-style.ts genomeToStyleVec)
  ts: CoarseTs; // coarse fusion timestamp
  backend: SegmentBackend;
}

export interface FuseChildMemoryResult {
  service: MemoryService; // the child's MemoryService (escrow held server-side)
  ownerL2Key: Buffer; // the child's fresh L2 epoch key, sealed to the fuser (no-escrow; handed to the fuser)
  inheritedL1Count: number; // number of blended L1 records the child inherited
  l1SegRoot: string; // content root of the child's founding L1 segment (tamper-evident)
}

/**
 * Build the child's founding memory: create a fresh MemoryService owned by the fuser (this seeds an EMPTY L2
 * sealed to the fuser = the RESET), then append the blended L1 (the INHERIT). Returns the child service + the
 * fuser's fresh L2 key. The child's L2 is empty by construction; the child's L1 is the blend of both parents.
 */
export async function fuseChildMemory(input: FuseChildMemoryInput): Promise<FuseChildMemoryResult> {
  const { childAgentId, fuserAddr, fuserPubkey, parentAL1, parentBL1, childStyle, ts, backend } = input;

  // RESET L2: a brand-new agent for the fuser starts with a fresh, empty relationship layer sealed to the
  // fuser (identical to the "new owner" branch of memory/transfer.ts). MemoryService.create seeds epoch 0 for
  // BOTH layers with empty segments; L2 stays empty (we only write L1 below), so the relationship is clean.
  const { service, ownerL2Key } = MemoryService.create({
    agentId: childAgentId,
    ownerAddr: fuserAddr,
    ownerPubkey: fuserPubkey,
    backend,
  });

  // INHERIT L1: blend both parents' owner-agnostic intrinsic records + the genome-derived style, then append
  // as the child's founding L1 segment (re-sealed to the fuser via the child's escrow key at epoch 0). The
  // blend always has >= 1 record (the founding style_delta), so appendIntrinsic never sees an empty batch.
  const blended = blendIntrinsic(parentAL1, parentBL1, childStyle, ts);
  const ref = await service.appendIntrinsic(blended);

  return { service, ownerL2Key, inheritedL1Count: blended.length, l1SegRoot: ref.root };
}

/**
 * Assert the child's memory has the FUSION shape: L1 non-empty (inherited) + L2 EMPTY (reset). Used by the
 * fuse pipeline as a self-check and by tests. Returns a structured verdict.
 */
export function assertFusionMemoryShape(service: MemoryService): { l1Inherited: boolean; l2Reset: boolean; ok: boolean } {
  const l1Inherited = service.manifest.intrinsic.segments.length > 0;
  const l2Reset = service.manifest.relationship.segments.length === 0;
  return { l1Inherited, l2Reset, ok: l1Inherited && l2Reset };
}

// readLayer re-export note: the owner-side read (with the fuser's privkey) uses the shipped readLayer; the
// server-side blend uses readIntrinsicViaEscrow above. Both resolve to the same segments.
export { readLayer };
