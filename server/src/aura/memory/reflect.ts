// SERVER-ONLY. The one-way DATAFLOW MEMBRANE (M3): selfReflect() is the ONLY writer to Layer 1.
//
// The strongest control in the design (MEMORY-DESIGN-owner-safety §3.1). selfReflect is ARCHITECTURALLY
// NOT GIVEN the OwnerIdentityVault and NOT given raw chat text. Its inputs are (i) the agent's prior
// intrinsic self-state and (ii) a DERIVED self-change summary ("palette trended warmer"). Owner PII has
// no code path into Layer 1 because there is no parameter on which it can arrive. The DerivedSelfChange
// type below has no owner/chat/identity field — that absence IS the membrane.
//
// On top of the membrane: the no-owner-field schema (types.ts) + the fail-closed scrubber (scrubber.ts).
// A free-text field that fails the scrub is FAIL-CLOSED: an OPTIONAL field is stripped; a REQUIRED field
// drops the record OUT of Layer 1 and routes the content to Layer 2 (never the transferable layer).
//
// MVP scope (research report §3): basic scrubber (format + epoch denylist). Full NER is fast-follow.
import { scrubText } from "./scrubber.js";
import type { CoarseTs, IntrinsicRecord, RelationshipRecord, StyleVec } from "./types.js";

/**
 * The ONLY thing selfReflect is allowed to see. By construction it carries NO owner identity and NO raw
 * chat — only the agent's derived self-state. (Adding an owner/chat field here would breach the membrane.)
 */
export interface DerivedSelfChange {
  style?: { before: StyleVec; after: StyleVec; note?: string };
  skills?: { tag: string; proficiency: number }[];
  tasteNotes?: string[]; // abstract, de-attributed ("leans toward warm, architectural")
  publicWorks?: { workRoot: string; outputNftId?: string; techniqueTags: string[] }[];
}

export interface ReflectResult {
  intrinsic: IntrinsicRecord[]; // clean -> Layer 1 (transfers)
  downgradedToL2: RelationshipRecord[]; // failed the scrub -> Layer 2 (resets), never L1
  dropped: { field: string; reason: string }[]; // audit trail of what the membrane caught
}

/**
 * Derive Layer-1 intrinsic records from a self-change summary, enforcing the membrane + scrubber.
 * @param change        derived self-state ONLY (no identity, no raw chat — enforced by the type)
 * @param ts            coarse timestamp (day-granularity; kills the H1 timestamp side-channel)
 * @param epochDenylist the CURRENT owner's identity values (vault) used to REJECT — known to block, never
 *                      to write. Scrubbing contemporaneously means the owner's name never enters L1.
 */
export function selfReflect(change: DerivedSelfChange, ts: CoarseTs, epochDenylist: string[] = []): ReflectResult {
  const intrinsic: IntrinsicRecord[] = [];
  const downgradedToL2: RelationshipRecord[] = [];
  const dropped: { field: string; reason: string }[] = [];
  const scrub = (t: string) => scrubText(t, epochDenylist);

  // style_delta: structured before/after (minimal leak surface) + an OPTIONAL note (strip if dirty).
  if (change.style) {
    let note = change.style.note;
    if (note !== undefined) {
      const v = scrub(note);
      if (!v.ok) {
        dropped.push({ field: "style.note", reason: v.reason });
        downgradedToL2.push({ kind: "rapport", tone: "", runningContext: note, insideRefs: [], ts });
        note = undefined; // OPTIONAL field stripped — the structured delta still goes to L1
      }
    }
    // The StyleVec fields are the agent's own style; scrub the descriptor (the freest text in the vec).
    const dv = scrub(change.style.after.descriptor);
    if (!dv.ok) {
      dropped.push({ field: "style.after.descriptor", reason: dv.reason });
      downgradedToL2.push({ kind: "rapport", tone: "", runningContext: change.style.after.descriptor, insideRefs: [], ts });
    } else {
      intrinsic.push({ kind: "style_delta", before: change.style.before, after: change.style.after, note, ts });
    }
  }

  // skill: tag is short + controlled-ish, but scrub it (fail-closed: drop the skill if dirty).
  for (const s of change.skills ?? []) {
    const v = scrub(s.tag);
    if (!v.ok) {
      dropped.push({ field: `skill.tag:${s.tag}`, reason: v.reason });
      continue; // dropped entirely (a skill tag has no L2 home; just don't leak it)
    }
    intrinsic.push({ kind: "skill", tag: s.tag, proficiency: s.proficiency, ts });
  }

  // taste: descriptor is REQUIRED free text -> a dirty one downgrades the whole record to L2.
  for (const t of change.tasteNotes ?? []) {
    const v = scrub(t);
    if (!v.ok) {
      dropped.push({ field: "taste.descriptor", reason: v.reason });
      downgradedToL2.push({ kind: "rapport", tone: "", runningContext: t, insideRefs: [], ts });
      continue;
    }
    intrinsic.push({ kind: "taste", descriptor: t, ts });
  }

  // work_public: roots/ids are content addresses (not free text); scrub the technique tags.
  for (const w of change.publicWorks ?? []) {
    let dirtyTag: { tag: string; reason: string } | null = null;
    for (const tag of w.techniqueTags) {
      const v = scrub(tag);
      if (!v.ok) {
        dirtyTag = { tag, reason: v.reason };
        break;
      }
    }
    if (dirtyTag) {
      dropped.push({ field: `work_public.techniqueTags:${dirtyTag.tag}`, reason: dirtyTag.reason });
      continue; // fail-closed: drop the whole work record rather than leak a tag
    }
    intrinsic.push({
      kind: "work_public",
      workRoot: w.workRoot,
      outputNftId: w.outputNftId,
      techniqueTags: w.techniqueTags,
      ts,
    });
  }

  return { intrinsic, downgradedToL2, dropped };
}
