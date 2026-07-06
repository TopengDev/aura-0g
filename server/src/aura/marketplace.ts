// SERVER-ONLY. Marketplace reads for the v2 generalized AuraMarketplace (multi-collection).
// Listings are keyed by listingKey(collection, tokenId), so we scan BOTH the agent collection and the
// output collection over their id ranges and surface the active listings + platform info.
// (List/buy are USER actions; the backend only reads. Active-listing discovery via events is Phase 3.)
import { ethers } from "ethers";
import { marketRead, registryRead, outputRead } from "./contracts.js";
import { CONTRACTS } from "./config.js";
import type { MarketplaceView } from "./types.js";

export async function getMarketplace(): Promise<MarketplaceView> {
  const mkt = marketRead();
  const reg = registryRead();
  const out = outputRead();

  const platform: string = await mkt.platform();
  const platformBps = Number(await mkt.platformBps());

  const activeListings: MarketplaceView["activeListings"] = [];

  // scan the AGENT collection - but ONLY when a real AgentRegistry is deployed. Post the mainnet ERC-7857
  // cutover the legacy AgentRegistry is address(0) (agents live on AuraINFT, which the AuraMarketplace cannot
  // trade - its safeTransferFrom reverts). Calling nextAgentId() on 0x000 reverts, so guard it. Priced AGENT
  // sales are served by GET /market/agents (the server-custodian Flow B), not this on-chain marketplace scan.
  const agentRegistryLive = /^0x[0-9a-fA-F]{40}$/.test(CONTRACTS.agentRegistry) && !/^0x0{40}$/i.test(CONTRACTS.agentRegistry);
  if (agentRegistryLive) {
    try {
      const nextAgent = Number(await reg.nextAgentId());
      for (let i = 1; i < nextAgent; i++) {
        try {
          const key = await mkt.listingKey(CONTRACTS.agentRegistry, i);
          const l = await mkt.listings(key);
          if (l.active) {
            activeListings.push({
              collection: CONTRACTS.agentRegistry,
              collectionName: "agent",
              tokenId: i,
              seller: l.seller,
              price: ethers.formatEther(l.price),
            });
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* AgentRegistry not readable (e.g. address(0) post-cutover) - agent sales come from /market/agents */
    }
  }

  // scan the OUTPUT collection
  const nextOut = Number(await out.nextTokenId());
  for (let i = 1; i < nextOut; i++) {
    try {
      const key = await mkt.listingKey(CONTRACTS.outputNFT, i);
      const l = await mkt.listings(key);
      if (l.active) {
        activeListings.push({
          collection: CONTRACTS.outputNFT,
          collectionName: "output",
          tokenId: i,
          seller: l.seller,
          price: ethers.formatEther(l.price),
        });
      }
    } catch {
      /* skip */
    }
  }

  return {
    contract: CONTRACTS.marketplace,
    platform,
    platformBps,
    platformPct: platformBps / 100,
    collections: { agentRegistry: CONTRACTS.agentRegistry, outputNFT: CONTRACTS.outputNFT },
    activeListings,
  };
}
