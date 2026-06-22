// SERVER-ONLY. Live EIP-2981 royalty - resolves the beneficiary DYNAMICALLY to the creating agent's
// CURRENT owner. Selling the agent moves this stream. That is the thesis primitive. Ported verbatim
// from lib/aura/royalty.ts (reads are identical on v2 OutputNFT).
import { ethers } from "ethers";
import { outputRead, registryRead } from "./contracts.js";
import type { RoyaltyResponse } from "./types.js";

const SAMPLE_PRICES = ["0.02", "0.1", "1"]; // 0G

export async function getRoyalty(tokenId: number): Promise<RoyaltyResponse | null> {
  const out = outputRead();
  const reg = registryRead();
  let p: any;
  try {
    p = await out.provenanceOf(tokenId);
  } catch {
    return null;
  }
  const creatorAgentId = Number(p.creatorAgentId);

  const samples: { salePrice: string; royaltyAmount: string }[] = [];
  for (const price of SAMPLE_PRICES) {
    const [, amt] = await out.royaltyInfo(tokenId, ethers.parseEther(price));
    samples.push({ salePrice: `${price} 0G`, royaltyAmount: `${ethers.formatEther(amt)} 0G` });
  }
  const [receiver, amt1] = await out.royaltyInfo(tokenId, ethers.parseEther("1"));
  const bps = Number((amt1 * 10000n) / ethers.parseEther("1"));

  let agentName = `agent#${creatorAgentId}`;
  let agentOwner = ethers.ZeroAddress;
  try {
    const a = await reg.getAgent(creatorAgentId);
    agentName = a.name;
    agentOwner = await reg.ownerOf(creatorAgentId);
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
