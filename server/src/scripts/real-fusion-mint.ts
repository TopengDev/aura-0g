// SERVER-ONLY one-off. Perform a REAL, end-to-end fusion on the LIVE chain via the PLATFORM (sponsor) key, to
// verify the full fusion-identity pipeline in production: it mints a genuine fused child iNFT whose name is a
// beautiful 0G-derived coinage (not AURA-FUSION-N) and whose persona is a 0G blend of both parents. Sequence:
//   0. inject the sponsor's pubkey into wallet_pubkeys (the child seals its brain to the fuser = the sponsor)
//   1. registerGenesis on each parent that is not yet fusable (owner-gated; the sponsor owns the catalog auras)
//   2. requestFusion(parentA, parentB) + fee   -> requestId (commit)
//   3. wait for the reveal target block         -> fuseSeedOf resolves
//   4. executeFusionPipeline(requestId)         -> 0G gen + 0G name + 0G persona + staged brain/persona
//   5. executeFusion(...args)                   -> mints the child (reveal)   -> childId
//   6. finalize: promote the staged brain + persona to the childId
// Every on-chain step is verified before the next. IRREVERSIBLE (real mint): pass the two parent ids explicitly.
//
//   docker exec aura-server node dist/scripts/real-fusion-mint.js <parentA> <parentB>
//   e.g. two platform-owned catalog Legendaries:  docker exec aura-server node dist/scripts/real-fusion-mint.js 11 12
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { ethers } from "ethers";
import { sponsorSigner } from "../aura/wallet.js";
import { agentsRead, readProvider } from "../aura/contracts.js";
import { auraFusionRead, auraFusionWrite, auraFusionConfigured, GAME_CHAIN_ID } from "../aura/game/contracts.js";
import { genesisArgs, executeFusionPipeline } from "../aura/game/fuse.js";
import { storePubkey, pubkeyOf, pubkeyMatchesAddress } from "../aura/pubkey.js";
import { promoteBrainByRoot, brainByAgentId } from "../aura/store.js";
import { promotePersonaByRoot, personaByAgentId } from "../aura/persona-store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gasOverrides() {
  const fd = await readProvider().getFeeData();
  // use 1.25x the network gas price (floor 5 gwei) so a mainnet tx does not underprice + stall.
  const base = fd.gasPrice ?? 5_000_000_000n;
  const gasPrice = base > 4_000_000_000n ? (base * 5n) / 4n : 5_000_000_000n;
  return { gasPrice };
}

async function main(): Promise<void> {
  const parentA = Number(process.argv[2]);
  const parentB = Number(process.argv[3]);
  if (!Number.isInteger(parentA) || !Number.isInteger(parentB) || parentA < 1 || parentB < 1 || parentA === parentB) {
    console.error("usage: node dist/scripts/real-fusion-mint.js <parentA> <parentB>  (two DISTINCT positive agent ids)");
    process.exit(2);
  }
  if (!auraFusionConfigured()) {
    console.error("[real-fuse] AuraFusion not configured on this deploy. Aborting.");
    process.exit(2);
  }
  const signer = sponsorSigner();
  const sponsor = signer.address;
  const net = await readProvider().getNetwork();
  console.log(`\n=== REAL FUSION MINT (parents #${parentA} + #${parentB}) as platform ${sponsor.slice(0, 10)}... ===`);
  console.log(`[real-fuse] chainId=${net.chainId} (expect ${GAME_CHAIN_ID})  block=${await readProvider().getBlockNumber()}`);
  if (Number(net.chainId) !== GAME_CHAIN_ID) {
    console.error(`[real-fuse] connected chainId ${net.chainId} != game chain ${GAME_CHAIN_ID}. Aborting (wrong network).`);
    process.exit(2);
  }

  const inft = agentsRead();
  const fusion = auraFusionRead();

  // ── 0. sponsor pubkey (the child seals its AES brain key to the FUSER's pubkey) ──
  const sponsorPub = new ethers.Wallet((signer as any).privateKey).signingKey.publicKey; // uncompressed 0x04..
  if (!pubkeyMatchesAddress(sponsorPub, sponsor)) {
    console.error("[real-fuse] derived sponsor pubkey does not match the sponsor address (impossible). Aborting.");
    process.exit(1);
  }
  if (!pubkeyOf(sponsor)) {
    storePubkey(sponsor, sponsorPub);
    console.log(`[real-fuse] injected sponsor pubkey into wallet_pubkeys (needed for the per-owner child seal).`);
  } else {
    console.log(`[real-fuse] sponsor pubkey already present in wallet_pubkeys.`);
  }

  // ── 1. ensure both parents are owned by the sponsor + fusable (registerGenesis if needed) ──
  for (const pid of [parentA, parentB]) {
    const [owner, fusable] = await Promise.all([inft.ownerOf(pid), fusion.isFusable(pid)]);
    if (String(owner).toLowerCase() !== sponsor.toLowerCase()) {
      console.error(`[real-fuse] parent #${pid} is not owned by the platform (owner=${owner}). registerGenesis is owner-gated. Aborting.`);
      process.exit(1);
    }
    if (fusable) {
      console.log(`[real-fuse] parent #${pid} already fusable.`);
      continue;
    }
    const agent = await inft.getAgent(pid);
    const args = genesisArgs(pid, String(agent.styleFingerprint));
    console.log(`[real-fuse] registerGenesis(#${pid}, [${args.genome.join(",")}]) ...`);
    const tx = await auraFusionWrite(signer).registerGenesis(pid, args.genome, await gasOverrides());
    const rc = await tx.wait();
    console.log(`[real-fuse]   registered #${pid} in ${tx.hash} (block ${rc?.blockNumber}).`);
  }

  // ── 2. requestFusion (commit) ──
  const fee = await fusion.fusionFee();
  console.log(`[real-fuse] requestFusion(#${parentA}, #${parentB}) fee=${ethers.formatEther(fee)} ...`);
  const reqTx = await auraFusionWrite(signer).requestFusion(parentA, parentB, { value: fee, ...(await gasOverrides()) });
  const reqRc = await reqTx.wait();
  // parse the FusionRequested event for the requestId + targetBlock.
  let requestId = -1;
  let targetBlock = 0;
  for (const log of reqRc?.logs ?? []) {
    try {
      const p = auraFusionWrite(signer).interface.parseLog(log as any);
      if (p?.name === "FusionRequested") {
        requestId = Number(p.args.requestId);
        targetBlock = Number(p.args.targetBlock);
      }
    } catch { /* not our event */ }
  }
  if (requestId < 0) {
    console.error(`[real-fuse] could not find FusionRequested in the receipt (tx ${reqTx.hash}). Aborting.`);
    process.exit(1);
  }
  console.log(`[real-fuse]   requestId=${requestId} targetBlock=${targetBlock} in ${reqTx.hash}.`);

  // ── 3. wait for the reveal target block (fuseSeedOf reverts until then) ──
  console.log(`[real-fuse] waiting for the reveal block ${targetBlock} ...`);
  for (let i = 0; i < 120; i++) {
    const blk = await readProvider().getBlockNumber();
    if (blk >= targetBlock) {
      // confirm fuseSeedOf now resolves (blockhash available).
      try {
        await fusion.fuseSeedOf(requestId);
        console.log(`[real-fuse]   reveal ready at block ${blk} (fuseSeedOf resolves).`);
        break;
      } catch {
        /* blockhash not yet queryable this tick; keep polling */
      }
    }
    await sleep(2500);
  }

  // ── 4. run the pipeline (0G gen + 0G name + 0G persona + stage) ──
  console.log(`[real-fuse] running executeFusionPipeline(${requestId}) (0G gen + name + persona)...`);
  const result = await executeFusionPipeline(requestId, {});
  console.log(`[real-fuse]   childName = ${JSON.stringify(result.childName)}`);
  console.log(`[real-fuse]   persona   = ${JSON.stringify(result.persona)}`);
  const call = result.executeArgs.call;

  // ── 5. executeFusion (reveal / mint) ──
  console.log(`[real-fuse] executeFusion(reveal) minting the child...`);
  const exTx = await auraFusionWrite(signer).executeFusion(
    call.requestId,
    call.childName,
    call.childStyleFingerprint,
    call.childEncBrainRoot,
    call.childDataHash,
    call.childModelAttestation,
    call.royaltyBps,
    call.creatorResaleBps,
    call.childSealedKey,
    await gasOverrides(),
  );
  const exRc = await exTx.wait();
  let childId = -1;
  for (const log of exRc?.logs ?? []) {
    try {
      const p = auraFusionWrite(signer).interface.parseLog(log as any);
      if (p?.name === "FusionExecuted") childId = Number(p.args.childId);
    } catch { /* not our event */ }
  }
  console.log(`[real-fuse]   MINTED child #${childId} in ${exTx.hash}.`);
  if (childId < 0) {
    console.error(`[real-fuse] could not find FusionExecuted childId in the receipt. The mint tx is ${exTx.hash}; finalize manually.`);
    process.exit(1);
  }

  // ── 6. finalize: promote the staged brain + persona to the childId ──
  const promotedBrain = promoteBrainByRoot(call.childEncBrainRoot, childId, sponsor);
  const promotedPersona = promotePersonaByRoot(call.childEncBrainRoot, childId);
  console.log(`[real-fuse]   finalize: brain promoted=${promotedBrain}, persona promoted=${promotedPersona}.`);

  // ── evidence read-back ──
  const brainRow = brainByAgentId(childId);
  const personaRow = personaByAgentId(childId);
  const onchain = await inft.getAgent(childId);
  console.log(`\n=== REAL FUSION MINT COMPLETE ===`);
  console.log(JSON.stringify({
    childId,
    onChainName: String(onchain.name),
    requestTx: reqTx.hash,
    mintTx: exTx.hash,
    portraitRoot: brainRow?.canonicalBaseRoot ?? null,
    persona: personaRow
      ? { name: personaRow.name, derived: personaRow.derived, tagline: personaRow.tagline, personality: personaRow.personality, lore: personaRow.lore, signatureCharacter: personaRow.signatureCharacter, aesthetic: personaRow.aesthetic }
      : null,
  }, null, 2));
  console.log(`\nGET /agents/${childId} + /api/agents/${childId} now resolve the child's beautiful name + blended persona.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[real-fuse] fatal:", e);
  process.exit(1);
});
