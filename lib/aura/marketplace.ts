// SERVER-ONLY. Marketplace reads (minimal for Phase 1). list/buy as live mutations are out of
// scope for the wedge (they need a seller-owned token + approval + a distinct buyer wallet);
// the royalty-follows-agent SALE is already proven on-chain and surfaced here from demo/proof.json.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { marketRead, outputRead } from "./contracts";
import { GALILEO } from "./config";

const PROOF_PATH = path.join(process.cwd(), "demo/proof.json");

export interface MarketplaceView {
  platform: string;
  platformBps: number;
  platformPct: number;
  activeListings: { tokenId: number; seller: string; price: string }[];
  royaltyDemo: unknown | null; // the proven royalty-follows-agent sale
}

export async function getMarketplace(): Promise<MarketplaceView> {
  const mkt = marketRead();
  const out = outputRead();
  const platform: string = await mkt.platform();
  const platformBps = Number(await mkt.platformBps());

  const next = Number(await out.nextTokenId());
  const activeListings: { tokenId: number; seller: string; price: string }[] = [];
  for (let i = 1; i < next; i++) {
    try {
      const l = await mkt.listings(i);
      if (l.active) activeListings.push({ tokenId: i, seller: l.seller, price: ethers.formatEther(l.price) });
    } catch {
      /* skip */
    }
  }

  let royaltyDemo: unknown | null = null;
  try {
    if (existsSync(PROOF_PATH)) {
      const proof = JSON.parse(readFileSync(PROOF_PATH, "utf8"));
      const r = proof?.phases?.royalty;
      if (r) {
        royaltyDemo = {
          marketTokenId: r.marketTokenId,
          price: r.price,
          royaltyFollowsAgent: r.royaltyFollowsAgent,
          sale: r.sale,
          explorer: r.sale?.explorer ?? null,
          storageScan: GALILEO.storageScan,
        };
      }
    }
  } catch {
    royaltyDemo = null;
  }

  return { platform, platformBps, platformPct: platformBps / 100, activeListings, royaltyDemo };
}
