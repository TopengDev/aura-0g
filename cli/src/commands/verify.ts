// THE money command. Fetches the on-chain economic proof for a Relic, then LOCALLY recomputes the
// provable-pull seed, rarity, and subject from the PUBLIC on-chain preimage - never trusting the API's
// verdict. The recompute mirrors server/src/aura/gacha.ts byte-for-byte (it is a verbatim copy), so a
// juror running `aura verify <id>` re-derives the result independently. This is the "rig-evident,
// recompute it yourself" story made scriptable + trustless from any terminal.
import { api } from "../api.ts";
import { c, kv, heading, rarityBadge, check, ok, bad } from "../ui.ts";
import { pullSeedRoot, mapSubject, deriveRarity, rarityRoll, isProvablePullSeed } from "../gacha.ts";

export async function cmdVerify(args: string[]): Promise<void> {
  const idRaw = args[0];
  if (!idRaw || !/^\d+$/.test(idRaw)) throw new Error("usage: aura verify <relic-id>");
  const id = Number(idRaw);
  const json = args.includes("--json");

  const [proof, detail] = await Promise.all([api.summonProof(id), api.output(id).catch(() => null)]);

  if (!proof.isSummon || !proof.roll) {
    if (json) {
      process.stdout.write(JSON.stringify({ tokenId: id, isSummon: false, provable: false }, null, 2) + "\n");
      return;
    }
    process.stdout.write(heading(`Verify Relic ${c.gray(`#${id}`)}`));
    process.stdout.write(
      `  ${c.yellow("This Relic was not minted by a paid summon")} (sponsor-minted or pre-cutover), so there is\n` +
        `  no provable-pull seed to recompute. Its rarity reads ${rarityBadge(detail?.rarity ?? "Common")} (honest backward-compat).\n`,
    );
    if (detail) printOnChainChecks(detail);
    return;
  }

  // ── LOCAL, TRUSTLESS RECOMPUTE ─────────────────────────────────────────────────────────────────────
  // The preimage fields + onChainSeed below are PUBLIC on-chain values relayed by the API. We re-derive
  // the seedRoot from the preimage ourselves and assert it equals the committed seed; then we derive the
  // rarity + subject from the seed locally. We do NOT trust proof.roll.rarity / .seedMatches.
  const pre = proof.roll.seedPreimage;
  const onChainSeed = BigInt(proof.roll.onChainSeed);
  const localSeedRoot = pullSeedRoot({
    requestId: pre.requestId,
    buyer: pre.buyer,
    agentId: pre.agentId,
    summonBlockHash: pre.summonBlockHash,
  });
  const seedMatches = localSeedRoot === onChainSeed;
  const isPull = isProvablePullSeed(onChainSeed);
  const provable = seedMatches && isPull;
  const localRarity = deriveRarity(onChainSeed);
  const localRoll = isPull ? rarityRoll(onChainSeed) : null;
  const localSubject = mapSubject(onChainSeed);

  // cross-check the CLI's local result against what the API claimed (drift detector, not a trust anchor).
  const agreesWithApi =
    localRarity === proof.roll.rarity &&
    localRoll === proof.roll.rarityRoll &&
    localSubject.prose === proof.roll.subjectProse;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          tokenId: id,
          isSummon: true,
          recomputedLocally: { provable, seedMatches, rarity: localRarity, rarityRoll: localRoll, recomputedSeedRoot: localSeedRoot.toString() },
          onChainSeed: onChainSeed.toString(),
          seedPreimage: pre,
          subject: localSubject.tuple,
          subjectProse: localSubject.prose,
          apiAgrees: agreesWithApi,
          economicProof: { fulfillTx: proof.fulfillTx, fee: proof.fee, ownerCut: proof.ownerCut, platformFee: proof.platformFee, agentOwner: proof.agentOwner },
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  process.stdout.write(heading(`Verify Relic ${c.gray(`#${id}`)}   ${rarityBadge(localRarity)}`));

  // The trustless verdict, computed by THIS binary.
  process.stdout.write(c.bold("  Recomputed locally by this CLI ") + c.gray("(trustless - re-derived from on-chain preimage)") + "\n");
  process.stdout.write(
    "  " +
      check(seedMatches, `seed recomputes from public preimage  ${c.dim("(seedRoot == on-chain seed)")}`) +
      "\n  " +
      check(isPull, `seed is a real provable-pull seed  ${c.dim("(>= 2^64 keccak root)")}`) +
      "\n  " +
      (provable ? ok(c.green(c.bold("PROVABLE: rig-evident, recompute it yourself"))) : bad(c.red("NOT provable from on-chain data"))) +
      "\n\n",
  );

  process.stdout.write(
    kv([
      ["rarity", `${rarityBadge(localRarity)}  ${localRoll !== null ? c.dim(`roll ${localRoll} / 9999`) : ""}`],
      ["subject", c.white(localSubject.prose)],
    ]) + "\n\n",
  );

  // The exact public inputs anyone can re-hash. Honest about the trust boundary.
  process.stdout.write(c.bold("  Public on-chain preimage ") + c.gray("(fetched - these are on-chain values relayed by the API)") + "\n");
  process.stdout.write(
    kv([
      ["domain", c.dim(pre.domain)],
      ["requestId", c.dim(String(pre.requestId))],
      ["buyer", c.dim(pre.buyer)],
      ["agentId", c.dim(String(pre.agentId))],
      ["blockHash", c.dim(pre.summonBlockHash)],
      ["onChainSeed", c.dim(onChainSeed.toString())],
      ["recomputed", (seedMatches ? c.green : c.red)(localSeedRoot.toString())],
    ]) + "\n",
  );

  // Economic proof (the fee actually settled to the agent owner on-chain).
  process.stdout.write("\n" + c.bold("  Economic proof ") + c.gray("(on-chain Fulfilled event)") + "\n");
  process.stdout.write(
    kv([
      ["paid", `${c.bold(proof.fee ?? "?")} 0G  ${c.dim(`-> owner ${proof.ownerCut} + platform ${proof.platformFee}`)}`],
      ["agentOwner", c.dim(proof.agentOwner ?? "-")],
      ["fulfillTx", c.dim(proof.fulfillTx ?? "-")],
    ]) + "\n",
  );

  if (detail) printOnChainChecks(detail);

  process.stdout.write(
    "\n  " +
      (agreesWithApi ? c.dim("✔ local recompute agrees with the API response") : c.yellow("⚠ local recompute DISAGREES with the API - trust the local value")) +
      "\n",
  );
}

function printOnChainChecks(d: { verification: { agentExists: boolean; imageOnChain: boolean; teeAttestationPresent: boolean }; agent: { name: string } }): void {
  process.stdout.write("\n" + c.bold("  Provenance checks ") + c.gray("(fetched from chain)") + "\n");
  process.stdout.write(
    "  " +
      check(d.verification.agentExists, "creator agent exists on-chain") +
      "\n  " +
      check(d.verification.imageOnChain, "image root committed on-chain") +
      "\n  " +
      check(d.verification.teeAttestationPresent, "TEE attestation present") +
      "\n",
  );
}
