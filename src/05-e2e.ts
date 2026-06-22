// CP5 - END-TO-END loop: (generated image →) store on 0G Storage → mint OutputNFT on Galileo
// with creatorAgentId + provenanceHash + storageRoot → read it back on-chain.
// Uses the already-deployed contracts. If images/NOKTURNE.png exists, uses the real image; else a stub.
import { ethers } from "ethers";
import { existsSync, readFileSync } from "node:fs";
import { Indexer, MemData, defaultUploadOption } from "@0gfoundation/0g-ts-sdk";
import { GALILEO, privateKey } from "./config.js";

const REG = "0xEf948192c22957Eaa24a08782163b30037bA34bC";
const OUT = "0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb";
const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed) returns (uint256)",
  "function provenanceOf(uint256) view returns (tuple(uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed))",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation)",
];

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const signer = new ethers.Wallet(privateKey(), provider);

// 1. The image bytes (real generated one if present, else a stub for the loop proof).
const imgPath = "images/NOKTURNE.png";
const imageBytes = existsSync(imgPath) ? readFileSync(imgPath) : Buffer.from("STUB-IMAGE-BYTES-for-e2e-loop", "utf8");
console.log("image source:", existsSync(imgPath) ? imgPath + " (REAL)" : "stub", imageBytes.length, "bytes");

// 2. Store the image on 0G Storage → imageRoot.
const indexer = new Indexer(GALILEO.storageIndexerTurbo);
const [imgRes, imgErr] = await indexer.upload(new MemData(imageBytes), GALILEO.rpc, signer as any, { ...(defaultUploadOption as any) });
if (imgErr) throw new Error("image upload: " + imgErr);
const imageRoot = (imgRes as any).rootHash;
console.log("image stored. imageRoot:", imageRoot);

// 3. Store the provenance record → provenanceHash.
const prov = { creatorAgentId: 1, model: "qwen/qwen-image-edit-2511", prompt: "coffee shop at night, NOKTURNE", seed: 42, imageRoot, ts: "2026-06-21" };
const provBytes = Buffer.from(JSON.stringify(prov), "utf8");
const provenanceHash = ethers.keccak256(provBytes);
const teeAttestation = ethers.keccak256(Buffer.from("TeeML/dstack:" + imageRoot, "utf8"));

// 4. Mint OutputNFT with everything baked in.
const out = new ethers.Contract(OUT, OUT_ABI, signer);
const tx = await out.mintOutput(signer.address, 1, imageRoot, provenanceHash, teeAttestation, 42, { gasPrice: 5_000_000_000n });
const rcpt = await tx.wait();
console.log("minted. tx:", rcpt.hash);

// 5. Read it back on-chain.
const tokenId = (await out.queryFilter(out.filters.OutputMinted(), rcpt.blockNumber, rcpt.blockNumber))
  .map((l: any) => l.args.tokenId).pop();
const p = await out.provenanceOf(tokenId);
const [recv, amt] = await out.royaltyInfo(tokenId, ethers.parseEther("1"));
console.log("read-back tokenId:", tokenId.toString());
console.log("  creatorAgentId:", p.creatorAgentId.toString(), "imageRoot:", p.imageRoot);
console.log("  provenanceHash matches:", p.provenanceHash === provenanceHash);
console.log("  imageRoot matches stored:", p.imageRoot === imageRoot);
console.log("  royalty:", ethers.formatEther(amt), "0G ->", recv);
console.log("\n✅ END-TO-END loop complete: store -> mint(provenance+root) -> read-back.");
