// SERVER-ONLY. Live EIP-2981 royalty - resolves the beneficiary DYNAMICALLY to the creating agent's
// CURRENT owner. Selling the agent moves this stream. That is the thesis primitive. Ported verbatim
// from lib/aura/royalty.ts (reads are identical on v2 OutputNFT).
import { ethers } from "ethers";
import { outputRead, agentsRead } from "./contracts.js";
import type { RoyaltyResponse } from "./types.js";

const SAMPLE_PRICES = ["0.02", "0.1", "1"]; // 0G

const ONE_ETHER = ethers.parseEther("1");

export async function getRoyalty(tokenId: number): Promise<RoyaltyResponse | null> {
  const out = outputRead();
  const reg = agentsRead();

  // provenanceOf gates the read (return null if the token has no provenance). royaltyInfo(tokenId, 1e18)
  // depends only on tokenId (not the agentId), so fire both together instead of serializing them.
  let p: any;
  let receiver: string;
  let amt1: bigint;
  try {
    const [prov, royalty] = await Promise.all([
      out.provenanceOf(tokenId),
      out.royaltyInfo(tokenId, ONE_ETHER),
    ]);
    p = prov;
    [receiver, amt1] = royalty as [string, bigint];
  } catch {
    return null;
  }
  const creatorAgentId = Number(p.creatorAgentId);

  // EIP-2981 is LINEAR: royaltyInfo(salePrice) == salePrice * royaltyBps / 10000 (integer). So one call at
  // 1e18 recovers the exact integer bps, and every other sample is derived arithmetically with the SAME
  // formula the contract uses -> identical to querying per-price, minus 3 redundant RPCs.
  const bps = Number((amt1 * 10000n) / ONE_ETHER);
  const bpsBig = BigInt(bps);
  const samples = SAMPLE_PRICES.map((price) => {
    const amt = (ethers.parseEther(price) * bpsBig) / 10000n;
    return { salePrice: `${price} 0G`, royaltyAmount: `${ethers.formatEther(amt)} 0G` };
  });

  // getAgent + ownerOf both key on creatorAgentId -> independent, so Promise.all them.
  let agentName = `agent#${creatorAgentId}`;
  let agentOwner = ethers.ZeroAddress;
  try {
    const [a, owner] = await Promise.all([reg.getAgent(creatorAgentId), reg.ownerOf(creatorAgentId)]);
    agentName = a.name;
    agentOwner = owner;
  } catch {
    /* agent missing */
  }

  return {
    tokenId,
    creatorAgentId,
    agentName,
    royaltyBps: bps,
    royaltyPct: bps / 100,
    receiver,
    receiverIsAgentOwner: receiver.toLowerCase() === agentOwner.toLowerCase(),
    samples,
    thesis:
      "EIP-2981 royaltyInfo resolves live to ownerOf(creatorAgentId). Transfer the agent iNFT and this entire future royalty stream follows it to the new owner - enforced in the Marketplace buy() before the seller is paid.",
  };
}
