// PROBE 4 [CRITICAL]: hybrid end-to-end — sponsored generation → user-signed mint.
// The funded/server wallet pays compute + storage to produce a TEE-verified image + provenance args
// (imageRoot, provenanceHash, teeAttestation, seed), then sends mintOutput on 16602 with those EXACT
// args, minting to an ARBITRARY `to` (single-wallet rule → proves permissionless arbitrary-recipient
// minting). GREEN = sponsored-gen → on-chain-mint loop works end to end with provenance landing.
import { demoWallet, getBroker, imageService, generate, store, GALILEO, GAS } from "./lib-compute.mjs";
import { ethers } from "ethers";
import { writeFileSync, readFileSync } from "node:fs";

const OUT_ADDR = "0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb"; // deployed OutputNFT
const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed) returns (uint256)",
  "function provenanceOf(uint256) view returns (tuple(uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed))",
  "function ownerOf(uint256) view returns (address)",
  "function nextTokenId() view returns (uint256)",
  "event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation)",
];
const CREATOR_AGENT_ID = 2n; // RISO exists on the deployed registry

const w = demoWallet(); // server/sponsor wallet (pays compute+storage+mint gas)
console.log("sponsor/server wallet:", w.address);

// ARBITRARY recipient — a fresh random address DIFFERENT from the sender (proves arbitrary-recipient mint).
const recipient = ethers.Wallet.createRandom().address;
console.log("arbitrary mint recipient (to):", recipient, " [single-wallet rule: cannot fund a 2nd wallet, so prove arbitrary `to`]");

// 1. SPONSORED generation (server pays). Use a real base + style; capture the TEE proof.
const broker = await getBroker(w);
const svc = await imageService(broker);
const baseBytes = readFileSync("smoke/inputs/logo.png");
const seed = Math.floor(Math.random() * 1e9);
const prompt = "Keep the EXACT same logo mark (same shapes, composition). risograph duotone fluorescent pink and blue, halftone grain.";
console.log("\n[sponsored gen] generating …");
const g = await generate(broker, svc, baseBytes, prompt);
writeFileSync("smoke/outputs/p4-image.png", g.bytes);
console.log(`✓ gen: bytes=${g.bytes.length} verified=${g.verified} chatId=${g.chatId} teeSigner=${g.teeSigner} latency=${g.latencyMs}ms`);

// 2. store() the image → imageRoot.
console.log("[sponsored storage] storing image on 0G Storage …");
const sres = await store(w, g.bytes, "p4-image");
const imageRoot = sres.rootHash;
console.log(`✓ imageRoot=${imageRoot} storeTx=${sres.txHash} dedup=${sres.dedup}`);

// 3. Build provenance args.
const provRecord = {
  creatorAgentId: Number(CREATOR_AGENT_ID), model: svc.meta.model, prompt, seed,
  teeSigner: g.teeSigner, teeVerifiability: g.verifiability, teeVerified: g.verified, chatId: g.chatId, imageRoot,
};
const provenanceHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(provRecord)));
// teeAttestation = a bytes32 binding the TEE proof (signer+chatId+verified) — what the build would hash.
const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(`${g.teeSigner}|${g.chatId}|${g.verified}|${g.verifiability}`));
console.log("provenanceHash:", provenanceHash);
console.log("teeAttestation:", teeAttestation);

// 4. mintOutput on 16602 to the ARBITRARY recipient, with the EXACT provenance args (5 gwei legacy).
const out = new ethers.Contract(OUT_ADDR, OUT_ABI, w);
console.log("\n[on-chain mint] sending mintOutput → arbitrary recipient …");
const tx = await out.mintOutput(recipient, CREATOR_AGENT_ID, imageRoot, provenanceHash, teeAttestation, BigInt(seed), { gasPrice: GAS.gasPrice });
console.log("mint tx sent:", tx.hash);
const rcpt = await tx.wait();
console.log("✓ mint mined: status", rcpt.status, "block", rcpt.blockNumber, "gasUsed", rcpt.gasUsed.toString());

// parse tokenId from the OutputMinted event
const iface = new ethers.Interface(OUT_ABI);
let mintedTokenId = null;
for (const log of rcpt.logs) {
  try { const p = iface.parseLog(log); if (p?.name === "OutputMinted") { mintedTokenId = p.args.tokenId; break; } } catch {}
}
console.log("minted tokenId:", mintedTokenId?.toString());

// 5. Confirm the token landed at the arbitrary recipient with the EXACT provenance.
const owner = await out.ownerOf(mintedTokenId);
const onchainProv = await out.provenanceOf(mintedTokenId);
const ownerMatches = owner.toLowerCase() === recipient.toLowerCase();
const rootMatches = onchainProv.imageRoot === imageRoot;
const provHashMatches = onchainProv.provenanceHash === provenanceHash;
const teeMatches = onchainProv.teeAttestation === teeAttestation;
const seedMatches = onchainProv.seed === BigInt(seed);
console.log("\n=== ON-CHAIN VERIFICATION ===");
console.log("owner == arbitrary recipient:", ownerMatches, `(${owner})`);
console.log("imageRoot matches:", rootMatches);
console.log("provenanceHash matches:", provHashMatches);
console.log("teeAttestation matches:", teeMatches);
console.log("seed matches:", seedMatches);

const allGreen = ownerMatches && rootMatches && provHashMatches && teeMatches && seedMatches && rcpt.status === 1;
writeFileSync("smoke/outputs/p4-results.json", JSON.stringify({
  sponsorWallet: w.address, arbitraryRecipient: recipient, mintTx: tx.hash, mintedTokenId: mintedTokenId?.toString(),
  imageRoot, storeTx: sres.txHash, provenanceHash, teeAttestation, seed, genVerified: g.verified, genChatId: g.chatId,
  ownerMatches, rootMatches, provHashMatches, teeMatches, seedMatches, allGreen,
}, null, 2));
console.log(allGreen ? "\n=== PROBE 4 GREEN: sponsored-gen → arbitrary-recipient on-chain mint landed with exact provenance ===" : "\n=== PROBE 4 RED: a verification failed ===");
if (!allGreen) process.exit(1);
