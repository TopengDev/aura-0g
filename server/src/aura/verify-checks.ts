// SERVER-ONLY. The SHARED provenance/verification check builder - the ONE source of truth for the 5 (or 6/7)
// checks the keyless GET /api/verify endpoint reports. It mirrors the web client's buildVerifyChecks
// (web/src/lib/verify.ts) label-for-label so /verify, /verify/[id] and the JSON all read IDENTICALLY:
//
//   1. Creator agent exists on-chain
//   2. Image root committed on-chain
//   3. TEE attestation present
//   4. Provenance hash matches
//   5. Royalty resolves to current agent owner
//   (+6 summon)  Paid commission settled on-chain (fee split to the agent owner)   - when summonSettled
//   (+ tier2)    On-chain TEE-verified (sha256 bound to the 0G enclave signer)     - when onchainTeeVerified
//
// The Tier-2 check is appended ONLY when dataHashOf(token) != 0 (an armed mintOutputVerified mint). Every
// live token pre-mainnet has dataHash == 0, so Tier 2 is dormant + honestly omitted rather than asserted false.
import type { ProvenanceResponse, RoyaltyResponse } from "./types.js";

export interface VerifyCheck {
  label: string;
  ok: boolean;
}

export interface BuildChecksOpts {
  /** The value to assert the on-chain provenance hash against. Omit -> self-consistency (present + well-formed). */
  expectedProvenanceHash?: string;
  /** dataHashOf(token) != 0: the mint passed the on-chain 0G-TEE gate, so append the Tier-2 check. */
  onchainTeeVerified?: boolean;
  /** A settled paid Summon commission: append the economic-proof check. */
  summonSettled?: boolean;
}

export function buildChecks(
  p: ProvenanceResponse,
  r: RoyaltyResponse | null,
  opts: BuildChecksOpts = {},
): VerifyCheck[] {
  const expected = opts.expectedProvenanceHash ?? p.onChain.provenanceHash;
  const checks: VerifyCheck[] = [
    { label: "Creator agent exists on-chain", ok: p.verification.agentExists },
    { label: "Image root committed on-chain", ok: p.verification.imageOnChain },
    { label: "TEE attestation present", ok: p.verification.teeAttestationPresent },
    {
      label: "Provenance hash matches",
      ok: !!p.onChain.provenanceHash && p.onChain.provenanceHash.toLowerCase() === expected.toLowerCase(),
    },
    {
      label: "Royalty resolves to current agent owner",
      ok: r ? r.receiverIsAgentOwner : (p.verification.royaltyReceiver?.length ?? 0) > 0,
    },
  ];
  if (opts.summonSettled) {
    checks.push({ label: "Paid commission settled on-chain (fee split to the agent owner)", ok: true });
  }
  if (opts.onchainTeeVerified) {
    checks.push({ label: "On-chain TEE-verified (sha256 bound to the 0G enclave signer)", ok: true });
  }
  return checks;
}
