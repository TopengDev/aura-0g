// SERVER-ONLY. Mint an OutputNFT (provenance + storage root + TEE attestation baked on-chain).
// mintOutput is PERMISSIONLESS on the deployed contract — the capped demo wallet can call it
// (it only needs gas). It just requires the referenced creatorAgentId to exist.
import { ethers } from "ethers";
import { outputWrite, parseEvent } from "./contracts";
import { GAS } from "./config";

export interface MintParams {
  to: string;
  creatorAgentId: number;
  imageRoot: string;
  provenanceHash: string;
  teeAttestation: string;
  seed: number;
}

export async function mintOutput(signer: ethers.Wallet, params: MintParams): Promise<{ tokenId: number; txHash: string }> {
  const out = outputWrite(signer);
  const tx = await out.mintOutput(
    params.to,
    params.creatorAgentId,
    params.imageRoot,
    params.provenanceHash,
    params.teeAttestation,
    params.seed,
    GAS,
  );
  const rcpt = await tx.wait();
  const ev = parseEvent(rcpt, out.interface, "OutputMinted");
  const tokenId = ev ? Number(ev.tokenId) : Number(await out.nextTokenId()) - 1;
  return { tokenId, txHash: rcpt.hash };
}
