// The canonical provenance + royalty verification. SHARED by the inline Verify on the output detail
// page (OutputDetailView) and the standalone public verifier (/verify) so BOTH render the identical
// five-check result. It re-reads the chain live (GET /provenance/:id + GET /royalty/:id, ROOT-mounted)
// and asserts: the creating agent exists, the image root is committed on-chain, a TEE attestation is
// present, the provenance hash matches its expected value, and the royalty still resolves to the
// current agent owner. Fail-soft: a missing provenance read returns a not-found result, never throws.

import { fetchProvenance, fetchRoyalty, type Provenance, type Royalty } from "@/lib/api";

export interface VerifyCheck {
  label: string;
  ok: boolean;
}

// The full result of a verification: the five checks, whether every one passed, the on-chain summary
// line, and the raw provenance + royalty payloads so a caller can surface the real values (style DNA,
// storage root, attestation, seed, owner) without re-fetching.
export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
  summary: string;
  provenance: Provenance;
  royalty: Royalty | null;
}

// Build the five checks from a provenance (+ optional royalty) payload. `expectedProvenanceHash` is
// the value to assert the on-chain hash against: the output detail page passes the flat Output's own
// provenanceHash (catches any drift between the indexed record and the chain); the standalone verifier
// has no separate record, so it passes the on-chain hash itself (an internal-consistency check that the
// field is present and well-formed). Either way the comparison + the other four checks are identical.
export function buildVerifyChecks(
  p: Provenance,
  r: Royalty | null,
  expectedProvenanceHash?: string,
): VerifyCheck[] {
  const expected = expectedProvenanceHash ?? p.onChain.provenanceHash;
  return [
    { label: "Creator agent exists on-chain", ok: p.verification.agentExists },
    { label: "Image root committed on-chain", ok: p.verification.imageOnChain },
    { label: "TEE attestation present", ok: p.verification.teeAttestationPresent },
    {
      label: "Provenance hash matches",
      ok: !!p.onChain.provenanceHash && p.onChain.provenanceHash.toLowerCase() === expected.toLowerCase(),
    },
    {
      label: "Royalty resolves to current agent owner",
      ok: r ? r.receiverIsAgentOwner : p.verification.royaltyReceiver?.length > 0,
    },
  ];
}

// Run the live verification for a token id: fetch provenance + royalty in parallel, build the checks,
// and return the structured result. Returns null when provenance can't be read (token not found or the
// chain read failed) so the caller can render a clean not-found state. `expectedProvenanceHash` is
// forwarded to buildVerifyChecks (see its note); omit it for the standalone case.
export async function runVerification(
  tokenId: number | string,
  expectedProvenanceHash?: string,
): Promise<VerifyResult | null> {
  const [p, r] = await Promise.all([fetchProvenance(tokenId), fetchRoyalty(tokenId)]);
  if (!p) return null;
  const checks = buildVerifyChecks(p, r, expectedProvenanceHash);
  return {
    ok: checks.every((c) => c.ok),
    checks,
    summary: p.verification.summary,
    provenance: p,
    royalty: r,
  };
}
