// SERVER-ONLY. Outputs = on-chain OutputNFT truth + off-chain enrichment (image/label/TEE) + live royalty.
import { ethers } from "ethers";
import { outputRead, registryRead, marketRead, txUrl, storageScanUrl } from "./contracts";
import { legacyByToken, mintRecordByToken } from "./store-index";
import type { OutputSummary } from "./types";

const SAMPLE_PRICE = ethers.parseEther("1");

async function agentNames(): Promise<Map<number, string>> {
  const reg = registryRead();
  const next = Number(await reg.nextAgentId());
  const m = new Map<number, string>();
  for (let i = 1; i < next; i++) {
    try {
      const a = await reg.getAgent(i);
      m.set(i, a.name);
    } catch {
      /* skip */
    }
  }
  return m;
}

/** Build the API summary for one output token (live chain reads + enrichment). */
export async function buildOutputSummary(tokenId: number, names?: Map<number, string>): Promise<OutputSummary | null> {
  const out = outputRead();
  const mkt = marketRead();
  let p: any;
  try {
    p = await out.provenanceOf(tokenId);
  } catch {
    return null; // no such output
  }
  const owner: string = await out.ownerOf(tokenId);
  const [royaltyReceiver, royaltyAmt] = await out.royaltyInfo(tokenId, SAMPLE_PRICE);
  const listing = await mkt.listings(tokenId);
  const nameMap = names ?? (await agentNames());

  const creatorAgentId = Number(p.creatorAgentId);
  const legacy = legacyByToken().get(tokenId);
  const minted = mintRecordByToken(tokenId);
  const enrich = minted ?? legacy ?? null;
  const imageKey = enrich?.imageKey ?? `output-${tokenId}`;

  // royaltyInfo(1 OG) → bps = amount * 10000 / 1e18
  const bps = Number((royaltyAmt * 10000n) / SAMPLE_PRICE);

  return {
    tokenId,
    creatorAgentId,
    agentName: nameMap.get(creatorAgentId) ?? `agent#${creatorAgentId}`,
    owner,
    imageRoot: p.imageRoot,
    imageUrl: `/api/image/${imageKey}`,
    storageScanUrl: storageScanUrl(p.imageRoot),
    seed: Number(p.seed),
    label: enrich?.label ?? null,
    teeVerified: enrich?.teeVerified ?? "n/a",
    model: enrich?.model ?? "qwen/qwen-image-edit-2511",
    royalty: { receiver: royaltyReceiver, bps, pct: bps / 100 },
    listing: {
      active: Boolean(listing.active),
      price: listing.active ? ethers.formatEther(listing.price) : null,
      seller: listing.active ? listing.seller : null,
    },
    mintTx: minted?.mintTx ?? legacy?.mintTx ?? null,
    explorerUrl: (minted?.mintTx ?? legacy?.mintTx) ? txUrl((minted?.mintTx ?? legacy?.mintTx)!) : null,
  };
}

/** The full collection — newest first. */
export async function listOutputs(): Promise<OutputSummary[]> {
  const out = outputRead();
  const next = Number(await out.nextTokenId());
  const names = await agentNames();
  const ids: number[] = [];
  for (let i = next - 1; i >= 1; i--) ids.push(i);
  const summaries = await Promise.all(ids.map((id) => buildOutputSummary(id, names)));
  return summaries.filter((s): s is OutputSummary => s !== null);
}
