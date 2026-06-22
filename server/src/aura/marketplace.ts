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

  // scan the AGENT collection
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
