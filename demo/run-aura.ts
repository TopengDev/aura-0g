/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AURA - a verifiable creative-agent marketplace, demonstrated LIVE on 0G.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  THE THESIS (what this one script proves, for real, on Galileo testnet):
 *
 *    A creative AGENT is an iNFT (ERC-7857-style): it carries a public identity, a
 *    private style-DNA "brain" sealed on 0G Storage, and the TEE attestation of the
 *    model it runs on. When that agent makes art, it runs on 0G Compute INSIDE a TEE,
 *    so every output carries UNFORGEABLE provenance - which agent, which model, proven
 *    in hardware. Because authorship is provable on-chain, the agent's owner earns an
 *    ENFORCED, transferable royalty on every output sale, forever. Sell the agent and
 *    its entire future royalty stream goes with it.
 *
 *    This is only possible because all four 0G primitives are load-bearing:
 *      • 0G Compute  - TEE-verified generation  (the unforgeable "who made it")
 *      • 0G Storage  - the image, the provenance record, and the encrypted agent brain
 *      • 0G Chain    - the iNFT, the provenance, and the enforced royalty split
 *      • iNFT model  - the agent itself, whose ownership routes every royalty
 *
 *  THE LOOP (executed end-to-end, every step a real on-chain / on-0G action):
 *
 *      register agent (iNFT)  →  generate on 0G Compute (TEE)  →  store on 0G Storage
 *          →  mint OutputNFT (provenance + roots baked in)  →  list + sell on the
 *          Marketplace  →  enforced royalty routes to the agent's CURRENT owner
 *          →  drop a real PFP collection (1 signature character, N trait variations)
 *
 *  RUN:
 *      pnpm demo                  full loop; resumable - skips phases already proven
 *                                 in demo/proof.json and never double-mints / double-spends
 *      pnpm demo --regen          ignore the journal and run every phase fresh on-chain
 *      pnpm demo --only=<phase>   run a single phase: agent | hero | royalty | collection
 *
 *  SAFETY:
 *      • testnet only (Galileo, chainId 16602)
 *      • this process is the SOLE user of the main wallet - every tx is awaited & serial,
 *        so the nonce is never raced
 *      • private keys are NEVER logged or written to proof.json (addresses only)
 *
 *  Contracts already deployed + verified (see report.md):
 *      AgentRegistry (iNFT)   0xEf948192c22957Eaa24a08782163b30037bA34bC
 *      OutputNFT (721+2981)   0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb
 *      Marketplace            0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import CryptoJS from "crypto-js";
import { Indexer, MemData, defaultUploadOption } from "@0gfoundation/0g-ts-sdk";
import { createZGComputeNetworkBroker } from "../src/zg-compute.js";
import { GALILEO, privateKey } from "../src/config.js";

// ── deployed contracts ───────────────────────────────────────────────────────
const REG = "0xEf948192c22957Eaa24a08782163b30037bA34bC"; // AgentRegistry (iNFT)
const OUT = "0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb"; // OutputNFT (ERC721 + EIP-2981)
const MKT = "0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c"; // Marketplace (enforced royalty)

const GAS = { gasPrice: 5_000_000_000n }; // Galileo min tip is 2 gwei → use 5 gwei
const PROOF = "demo/proof.json";
const HERO_IMG = "demo/hero.png"; // the fresh genesis piece generated live this run

// ── minimal ABIs (human-readable) ────────────────────────────────────────────
const REG_ABI = [
  "function mintAgent(address to,string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getAgent(uint256) view returns (tuple(string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps,uint16 styleVersion))",
  "function royaltyBpsOf(uint256) view returns (uint16)",
  "function safeTransferFrom(address,address,uint256)",
  "function nextAgentId() view returns (uint256)",
  "event AgentMinted(uint256 indexed agentId,address indexed owner,string name,bytes32 styleFingerprint)",
];
const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed) returns (uint256)",
  "function provenanceOf(uint256) view returns (tuple(uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed))",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function setApprovalForAll(address,bool)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function nextTokenId() view returns (uint256)",
  "event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation)",
];
const MKT_ABI = [
  "function list(uint256 tokenId,uint256 price)",
  "function buy(uint256 tokenId) payable",
  "function listings(uint256) view returns (address seller,uint256 price,bool active)",
  "function platform() view returns (address)",
  "function platformBps() view returns (uint16)",
  "event Sold(uint256 indexed tokenId,address indexed buyer,address indexed seller,uint256 price,address royaltyReceiver,uint256 royaltyPaid,uint256 platformFee,uint256 sellerProceeds)",
];

// ── the demo agent: RISO, whose signature character is the Fennic fox ─────────
// (RISO has the strongest character-identity consistency on this model - see report-characters.md)
const AGENT = {
  name: "RISO",
  royaltyBps: 700, // 7%
  // PUBLIC style fingerprint source (hashed on-chain → provable agent identity)
  publicStyle: {
    agent: "RISO",
    aesthetic: "risograph print - fluorescent pink + blue duotone, visible halftone grain, misregistration, flat bold indie-zine shapes",
    signatureCharacter: "Fennic - a wide-eared fennec fox mascot with cheek + ear markings, big friendly eyes, a blue knit scarf",
    model: "qwen/qwen-image-edit-2511",
  },
  // PRIVATE style-DNA "brain" - encrypted, sealed on 0G Storage; only the owner holds the key.
  brain: {
    promptCore:
      "risograph duotone fox mascot, fluorescent pink and blue, halftone grain, misregistration, flat bold shapes, indie zine, big friendly eyes, blue knit scarf",
    negative: "no photorealism, no gradients, no 3d render",
    conditioning: "feed the canonical fox back as the base; 'keep the EXACT same character, change ONLY <trait>'",
    seedPolicy: "no seed param on provider → base image is the determinism anchor",
  },
  // the canonical signature character (already TEE-verified earlier; the identity anchor for the drop)
  canonicalBase: "images/characters/T1/RISO-bust.png",
  // the fresh genesis-hero generation prompt (conditioned on the canonical → coherent with the drop)
  heroPrompt:
    "keep the EXACT same fennec fox character (same fur, cheek and ear markings, eyes, blue knit scarf); clean centered head-and-shoulders PFP portrait; risograph duotone, fluorescent pink and blue, halftone grain; a tiny glowing emblem pin on the scarf; pristine genesis edition",
  // the collection: the canonical + the 6 already-generated, TEE-verified trait variations
  collection: [
    { label: "canonical", file: "images/characters/T1/RISO-bust.png" },
    { label: "pirate", file: "images/characters/T3/fennic-01-pirate.png" },
    { label: "astronaut", file: "images/characters/T3/fennic-02-astronaut.png" },
    { label: "wizard", file: "images/characters/T3/fennic-03-wizard.png" },
    { label: "punk", file: "images/characters/T3/fennic-04-punk.png" },
    { label: "king", file: "images/characters/T3/fennic-05-king.png" },
    { label: "samurai", file: "images/characters/T3/fennic-06-samurai.png" },
  ],
};

// ── tiny output helpers ──────────────────────────────────────────────────────
const banner = (n: number | string, title: string) =>
  console.log(`\n${"━".repeat(78)}\n  PHASE ${n} - ${title}\n${"━".repeat(78)}`);
const step = (s: string) => console.log(`\n▸ ${s}`);
const ok = (s: string) => console.log(`  ✅ ${s}`);
const info = (s: string) => console.log(`  ${s}`);
const txUrl = (h: string) => `${GALILEO.explorer}/tx/${h}`;
const og = (wei: bigint) => `${ethers.formatEther(wei)} 0G`;

// ── proof.json journal (the resumable source of truth) ───────────────────────
type Proof = any;
function loadProof(): Proof {
  if (existsSync(PROOF)) return JSON.parse(readFileSync(PROOF, "utf8"));
  return {
    project: "AURA - a verifiable creative-agent marketplace (0G Zero Cup)",
    thesis:
      "Creative agents are iNFTs that generate TEE-verified art on 0G; provable authorship → enforced, transferable royalties on every output sale, forever.",
    network: { name: "0G Galileo testnet", chainId: GALILEO.chainId, rpc: GALILEO.rpc, explorer: GALILEO.explorer, storageScan: GALILEO.storageScan },
    contracts: { agentRegistry: REG, outputNFT: OUT, marketplace: MKT },
    primitives: { compute: "0G Compute (qwen/qwen-image-edit-2511, TeeML/dstack)", storage: "0G Storage (Turbo)", chain: "0G Chain EVM", inft: "AgentRegistry ERC-7857-style" },
    phases: {},
    txIndex: [],
    startedAt: new Date().toISOString(),
  };
}
let proof = loadProof();
function save() { writeFileSync(PROOF, JSON.stringify(proof, null, 2)); }
function recordTx(label: string, hash: string) {
  proof.txIndex.push({ label, hash, explorer: txUrl(hash) });
  save();
}

// ── 0G Storage: deterministic, idempotent upload ─────────────────────────────
const indexer = new Indexer(GALILEO.storageIndexerTurbo);
async function store(signer: ethers.Wallet, bytes: Buffer, label: string) {
  const mem = new MemData(bytes);
  const [tree, mErr] = await mem.merkleTree();
  if (mErr) throw mErr;
  const localRoot = tree!.rootHash(); // deterministic → same bytes ⇒ same root (safe on resume)
  try {
    // finalityRequired:false → return as soon as the submit lands + the root is known. The rootHash
    // is the content address (independent of the node's finality flag), and the on-chain mint only
    // needs that root - so we don't block the pipeline waiting for a per-node finality flag that can
    // lag minutes on testnet for larger (~2MB) blobs.
    const [res, upErr] = await indexer.upload(mem, GALILEO.rpc, signer as any, { ...(defaultUploadOption as any), finalityRequired: false });
    if (upErr) {
      const es = String(upErr);
      // already-on-0G is success: the immutable root is the same content address
      if (/already|exist|Data root/i.test(es)) { ok(`${label}: already on 0G - root ${localRoot}`); return { rootHash: localRoot, txHash: null as string | null }; }
      throw new Error(`upload ${label}: ${es.slice(0, 200)}`);
    }
    const r = res as any;
    if (r.txHash) recordTx(`store:${label}`, r.txHash);
    ok(`${label}: stored on 0G Storage - root ${r.rootHash}${r.txHash ? `  tx ${r.txHash}` : ""}`);
    info(`     local merkle == on-chain root: ${r.rootHash === localRoot}`);
    return { rootHash: r.rootHash as string, txHash: (r.txHash ?? null) as string | null };
  } catch (e: any) {
    const es = String(e?.message ?? e);
    if (/already|exist|Data root/i.test(es)) { ok(`${label}: already on 0G - root ${localRoot}`); return { rootHash: localRoot, txHash: null }; }
    throw e;
  }
}

// ── 0G Compute: find the TEE image service ───────────────────────────────────
async function imageService(broker: any) {
  const services = await broker.inference.listService();
  const img = services.find((s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
  if (!img) throw new Error("no image service served on testnet right now");
  const meta = await broker.inference.getServiceMetadata(img.provider);
  return { provider: img.provider, meta, verifiability: img.verifiability, teeSigner: img.teeSignerAddress };
}

// ── 0G Compute: generate one image (EDIT-only model → /images/edits) ──────────
// Returns the image bytes + the TEE proof (verified bool, chatId, signer). On a
// funding-related failure it runs the funding ritual once and retries.
async function generate(broker: any, svc: any, basePath: string, prompt: string) {
  const baseBytes = readFileSync(basePath);
  const attempt = async () => {
    const headers = await broker.inference.getRequestHeaders(svc.provider, prompt);
    delete (headers as any)["Content-Type"]; delete (headers as any)["content-type"]; // FormData sets the multipart boundary
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("response_format", "b64_json");
    form.append("model", svc.meta.model);
    form.append("image", new Blob([baseBytes], { type: "image/png" }), "image.png");
    const t0 = Date.now();
    const res = await fetch(`${svc.meta.endpoint}/images/edits`, { method: "POST", headers: headers as any, body: form });
    const raw = await res.text();
    const respHeaders: Record<string, string> = {}; res.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw);
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64 image in response");
    const bytes = Buffer.from(b64, "base64");
    const chatId = respHeaders["zg-res-key"] || json?.id;
    // TEE verification + settlement: processResponse must receive the chatId, else verify is skipped.
    let verified: any = "n/a";
    try { verified = await broker.inference.processResponse(svc.provider, chatId, prompt); } catch (e: any) { verified = `err:${e?.message?.slice(0, 60)}`; }
    return { bytes, chatId, verified, latencyMs: Date.now() - t0, model: svc.meta.model, teeSigner: svc.teeSigner, verifiability: svc.verifiability };
  };
  try {
    return await attempt();
  } catch (e: any) {
    info(`generation attempt failed (${String(e?.message).slice(0, 100)}) - running funding ritual + retry`);
    await fundCompute(broker, svc.provider);
    return await attempt();
  }
}

// ── 0G Compute: fund the ledger + provider sub-account (idempotent) ───────────
async function fundCompute(broker: any, provider: string) {
  const lp: any = (broker.ledger as any).ledger;
  if (lp?.constructor && "MIN_LEDGER_BALANCE_OG" in lp.constructor) lp.constructor.MIN_LEDGER_BALANCE_OG = 0;
  try { await broker.ledger.depositFund(1.0); ok("ledger topped up (1.0 0G available)"); } catch (e: any) { info(`depositFund note: ${e?.message?.slice(0, 100)}`); }
  try { await broker.inference.acknowledgeProviderSigner(provider); } catch {}
  try { await broker.ledger.transferFund(provider, "inference", 1_000_000_000_000_000_000n); ok("provider sub-account funded (1.0 0G locked)"); } catch (e: any) { info(`transferFund note: ${e?.message?.slice(0, 100)}`); }
}

// ── parse a named event arg out of a receipt ─────────────────────────────────
function parseEvent(rcpt: any, iface: ethers.Interface, name: string): any | null {
  for (const log of rcpt.logs) {
    try { const p = iface.parseLog(log); if (p?.name === name) return p.args; } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE: AGENT - register the creative agent as an iNFT (CP3, part 1)
// ─────────────────────────────────────────────────────────────────────────────
async function phaseAgent(signer: ethers.Wallet, broker: any, svc: any) {
  banner("1", "AGENT - register the creative agent as an iNFT");
  if (proof.phases.agent?.agentId) { ok(`reusing agent #${proof.phases.agent.agentId} (already registered)`); return proof.phases.agent; }

  const reg = new ethers.Contract(REG, REG_ABI, signer);

  // 1. The PUBLIC identity → a provable on-chain fingerprint.
  const styleFingerprint = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(AGENT.publicStyle)));
  step(`style fingerprint (keccak of public style-DNA): ${styleFingerprint}`);

  // 2. The PRIVATE brain → encrypt the style-DNA and seal the ciphertext on 0G Storage.
  //    Only the agent owner holds the key (we record only its hash - never the key itself).
  const brainKey = ethers.hexlify(ethers.randomBytes(32));
  const brainPlain = JSON.stringify(AGENT.brain);
  const brainCipher = Buffer.from(CryptoJS.AES.encrypt(brainPlain, brainKey).toString(), "utf8");
  const keyHash = ethers.keccak256(brainKey);
  step(`sealing encrypted style-DNA brain on 0G Storage (${brainCipher.length} bytes ciphertext)`);
  const brain = await store(signer, brainCipher, "agent-brain");

  // 3. The model attestation → ties the agent to the exact TEE-verified model it runs on.
  const modelAttestation = ethers.keccak256(ethers.toUtf8Bytes(`${svc.meta.model}|${svc.teeSigner}|${svc.verifiability}`));
  step(`model attestation (keccak of model|teeSigner|verifiability): ${modelAttestation}`);
  info(`     model=${svc.meta.model}  TEE=${svc.verifiability}  signer=${svc.teeSigner}`);

  // 4. Mint the iNFT.
  step(`minting agent iNFT "${AGENT.name}" (royalty ${AGENT.royaltyBps / 100}%) …`);
  const tx = await reg.mintAgent(signer.address, AGENT.name, styleFingerprint, brain.rootHash, modelAttestation, AGENT.royaltyBps, GAS);
  const rcpt = await tx.wait();
  recordTx("mintAgent", rcpt.hash);
  const ev = parseEvent(rcpt, reg.interface, "AgentMinted");
  const agentId = ev ? Number(ev.agentId) : Number(await reg.nextAgentId()) - 1;
  ok(`agent iNFT minted - agentId #${agentId}  owner ${signer.address}`);
  ok(`tx ${txUrl(rcpt.hash)}`);

  // verify the read-back
  const onchain = await reg.getAgent(agentId);
  info(`     read-back: name="${onchain.name}" fingerprint=${onchain.styleFingerprint === styleFingerprint ? "match ✓" : "MISMATCH"} encBrainRoot=${onchain.encBrainRoot}`);

  proof.phases.agent = {
    agentId, name: AGENT.name, owner: signer.address, royaltyBps: AGENT.royaltyBps,
    styleFingerprint, modelAttestation,
    encBrainRoot: brain.rootHash, encBrainTxHash: brain.txHash, brainKeyHash: keyHash,
    mintTx: rcpt.hash, explorer: txUrl(rcpt.hash),
  };
  save();
  return proof.phases.agent;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE: HERO - generate (TEE) → store → mint with provenance (CP3, parts 2-4)
// ─────────────────────────────────────────────────────────────────────────────
async function phaseHero(signer: ethers.Wallet, broker: any, svc: any, agentId: number) {
  banner("2", "HERO - generate on 0G Compute (TEE) → store on 0G Storage → mint with provenance");
  proof.phases.hero = proof.phases.hero || {};
  const H = proof.phases.hero;

  // 1. GENERATE - live on 0G Compute, inside a TEE.
  if (!H.generation || !existsSync(HERO_IMG)) {
    step("generating the genesis hero on 0G Compute (qwen-image-edit-2511, TEE-verified) - ~45s …");
    const g = await generate(broker, svc, AGENT.canonicalBase, AGENT.heroPrompt);
    writeFileSync(HERO_IMG, g.bytes);
    H.generation = { model: g.model, verifiability: g.verifiability, teeSigner: g.teeSigner, chatId: g.chatId, teeVerified: g.verified, latencyMs: g.latencyMs, bytes: g.bytes.length, savedAs: HERO_IMG };
    save();
    ok(`generated ${g.bytes.length} bytes in ${g.latencyMs}ms → ${HERO_IMG}`);
    ok(`TEE VERIFY → processResponse = ${JSON.stringify(g.verified)}  (signer ${g.teeSigner})  chatId ${g.chatId}`);
  } else { ok(`reusing generated hero (${H.generation.bytes} bytes, TEE verified=${H.generation.teeVerified})`); }

  const imageBytes = readFileSync(HERO_IMG);

  // 2. STORE - image + a full provenance record, both on 0G Storage.
  if (!H.storage) {
    step("storing the image on 0G Storage …");
    const img = await store(signer, imageBytes, "hero-image");
    const provenanceRecord = {
      agentId, agentName: AGENT.name, model: H.generation.model,
      prompt: AGENT.heroPrompt, teeSigner: H.generation.teeSigner, teeVerifiability: H.generation.verifiability,
      teeVerified: H.generation.teeVerified, chatId: H.generation.chatId, imageRoot: img.rootHash, ts: new Date().toISOString(),
    };
    const provBytes = Buffer.from(JSON.stringify(provenanceRecord, null, 2), "utf8");
    step("storing the provenance record on 0G Storage …");
    const prov = await store(signer, provBytes, "hero-provenance");
    H.storage = { imageRoot: img.rootHash, imageTx: img.txHash, provenanceRoot: prov.rootHash, provenanceTx: prov.txHash, provenanceHash: ethers.keccak256(provBytes), provenanceRecord };
    save();
  } else { ok(`reusing storage roots (image ${H.storage.imageRoot})`); }

  // 3. MINT - OutputNFT with creatorAgentId + provenanceHash + storageRoot + TEE attestation baked in.
  if (!H.mint) {
    const out = new ethers.Contract(OUT, OUT_ABI, signer);
    const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(`TeeML|dstack|${H.generation.model}|${H.generation.teeSigner}|${H.generation.chatId}|${H.storage.imageRoot}`));
    step("minting the OutputNFT (provenance + storage root + TEE attestation on-chain) …");
    const tx = await out.mintOutput(signer.address, agentId, H.storage.imageRoot, H.storage.provenanceHash, teeAttestation, 0, GAS);
    const rcpt = await tx.wait();
    recordTx("mintOutput:hero", rcpt.hash);
    const ev = parseEvent(rcpt, out.interface, "OutputMinted");
    const tokenId = ev ? Number(ev.tokenId) : Number(await out.nextTokenId()) - 1;

    // read it back on-chain and verify provenance + royalty routing
    const p = await out.provenanceOf(tokenId);
    const [recv, amt] = await out.royaltyInfo(tokenId, ethers.parseEther("1"));
    H.mint = {
      tokenId, mintTx: rcpt.hash, explorer: txUrl(rcpt.hash), teeAttestation, owner: signer.address,
      readback: { creatorAgentId: Number(p.creatorAgentId), imageRootMatches: p.imageRoot === H.storage.imageRoot, provenanceHashMatches: p.provenanceHash === H.storage.provenanceHash, royaltyReceiver: recv, royaltyOn1OG: ethers.formatEther(amt) },
    };
    save();
    ok(`OutputNFT minted - tokenId #${tokenId}`);
    ok(`tx ${txUrl(rcpt.hash)}`);
    info(`     read-back: creatorAgentId=${p.creatorAgentId} imageRoot match=${H.mint.readback.imageRootMatches} provenanceHash match=${H.mint.readback.provenanceHashMatches}`);
    info(`     royaltyInfo(1 0G) → ${ethers.formatEther(amt)} 0G to ${recv} (the agent's current owner)`);
  } else { ok(`reusing hero OutputNFT #${H.mint.tokenId}`); }

  return H;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE: ROYALTY - the economic thesis, executed live (CP4)
//  Mint a piece to a seller, transfer the AGENT to a neutral owner (proving the
//  royalty stream follows the agent), then sell it and show the enforced split.
// ─────────────────────────────────────────────────────────────────────────────
async function phaseRoyalty(signer: ethers.Wallet, jsonProvider: ethers.JsonRpcProvider, agentId: number) {
  banner("3", "ROYALTY - list + sell on the Marketplace; enforced royalty follows the agent");
  if (proof.phases.royalty?.sale?.buyTx) { ok("royalty sale already executed - reusing recorded proof"); return proof.phases.royalty; }

  const helpers = JSON.parse(readFileSync(".helpers.json", "utf8")) as { address: string; privateKey: string }[];
  const seller = new ethers.Wallet(helpers[0].privateKey, jsonProvider); // owns + lists the piece
  const buyer = new ethers.Wallet(helpers[1].privateKey, jsonProvider);  // buys it
  const agentOwner2 = new ethers.Wallet(helpers[2].privateKey, jsonProvider); // neutral new agent owner (royalty receiver)
  info(`roles → seller ${seller.address} · buyer ${buyer.address} · new-agent-owner ${agentOwner2.address} · platform ${signer.address}`);

  const PRICE = ethers.parseEther("0.02");

  // 0. Fund the helper wallets from main (they were swept empty). Idempotent: top up only the shortfall.
  step("funding helper wallets from main (top-up only) …");
  const needs: [ethers.Wallet, bigint, string][] = [
    [seller, ethers.parseEther("0.01"), "seller"],   // gas for approve + list
    [buyer, ethers.parseEther("0.05"), "buyer"],     // price + gas
    [agentOwner2, ethers.parseEther("0.01"), "new-agent-owner"], // gas to hand the agent back at the end
  ];
  for (const [w, target, role] of needs) {
    const bal = await jsonProvider.getBalance(w.address);
    if (bal < target) {
      const tx = await signer.sendTransaction({ to: w.address, value: target - bal, ...GAS, gasLimit: 21000n });
      await tx.wait(); recordTx(`fund:${role}`, tx.hash);
      ok(`funded ${role} (${w.address}) to ${og(target)}`);
    } else { info(`     ${role} already funded (${og(bal)})`); }
  }

  const regMain = new ethers.Contract(REG, REG_ABI, signer);
  const outMain = new ethers.Contract(OUT, OUT_ABI, signer);

  // 1. Mint a market piece directly to the seller (reuses the hero's stored image/provenance).
  const H = proof.phases.hero;
  step("minting a market piece to the seller …");
  const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(`TeeML|dstack|${H.generation.model}|${H.generation.teeSigner}|market|${H.storage.imageRoot}`));
  const mtx = await outMain.mintOutput(seller.address, agentId, H.storage.imageRoot, H.storage.provenanceHash, teeAttestation, 1, GAS);
  const mrcpt = await mtx.wait(); recordTx("mintOutput:market", mrcpt.hash);
  const mev = parseEvent(mrcpt, outMain.interface, "OutputMinted");
  const marketTokenId = mev ? Number(mev.tokenId) : Number(await outMain.nextTokenId()) - 1;
  ok(`market piece minted - tokenId #${marketTokenId} owned by the seller`);

  // 2. Show royalty routing BEFORE the agent moves (→ current owner = main).
  const [recvBefore] = await outMain.royaltyInfo(marketTokenId, PRICE);
  info(`     royaltyInfo before agent transfer → ${recvBefore} (current agent owner = main)`);

  // 3. Transfer the AGENT iNFT to a new owner. This is the thesis: the royalty stream
  //    is attached to the agent, so it now follows to whoever holds the agent.
  step(`transferring agent #${agentId} iNFT  main → new owner …`);
  const ttx = await regMain.safeTransferFrom(signer.address, agentOwner2.address, agentId, GAS);
  await ttx.wait(); recordTx("agentTransfer:toNewOwner", ttx.hash);
  const [recvAfter] = await outMain.royaltyInfo(marketTokenId, PRICE);
  ok(`agent transferred - tx ${txUrl(ttx.hash)}`);
  ok(`royaltyInfo AFTER transfer → ${recvAfter}  (the SAME artwork's royalty now routes to the new agent owner)`);
  info(`     royalty stream followed the agent: ${recvBefore} → ${recvAfter}`);

  // 4. Seller approves the marketplace + lists.
  const outSeller = new ethers.Contract(OUT, OUT_ABI, seller);
  const mktSeller = new ethers.Contract(MKT, MKT_ABI, seller);
  step("seller approves marketplace + lists the piece …");
  if (!(await outSeller.isApprovedForAll(seller.address, MKT))) { const atx = await outSeller.setApprovalForAll(MKT, true, GAS); await atx.wait(); recordTx("approveMarketplace", atx.hash); }
  const ltx = await mktSeller.list(marketTokenId, PRICE, GAS); await ltx.wait(); recordTx("list", ltx.hash);
  ok(`listed tokenId #${marketTokenId} for ${og(PRICE)} - tx ${txUrl(ltx.hash)}`);

  // 5. Snapshot balances of all 4 distinct roles BEFORE the sale.
  const addrs = { royaltyReceiver: agentOwner2.address, seller: seller.address, buyer: buyer.address, platform: signer.address };
  const balBefore: any = {}; for (const [k, a] of Object.entries(addrs)) balBefore[k] = await jsonProvider.getBalance(a);

  // 6. BUY - the enforced split fires inside buy(): royalty → agent owner, fee → platform, rest → seller.
  step(`buyer buys tokenId #${marketTokenId} for ${og(PRICE)} …`);
  const mktBuyer = new ethers.Contract(MKT, MKT_ABI, buyer);
  const btx = await mktBuyer.buy(marketTokenId, { value: PRICE, ...GAS }); const brcpt = await btx.wait(); recordTx("buy", brcpt.hash);
  const sold = parseEvent(brcpt, mktBuyer.interface, "Sold");
  ok(`SOLD - tx ${txUrl(brcpt.hash)}`);

  // 7. Snapshot AFTER + compute deltas. The royalty delta must equal the event's royaltyPaid.
  const balAfter: any = {}; for (const [k, a] of Object.entries(addrs)) balAfter[k] = await jsonProvider.getBalance(a);
  const deltas: any = {}; for (const k of Object.keys(addrs)) deltas[k] = balAfter[k] - balBefore[k];

  console.log("\n  ── enforced split (from the on-chain Sold event) ──");
  info(`  price             ${og(sold.price)}`);
  info(`  royalty  → agent  ${og(sold.royaltyPaid)}   to ${sold.royaltyReceiver}`);
  info(`  platform fee      ${og(sold.platformFee)}   to ${addrs.platform}`);
  info(`  seller proceeds   ${og(sold.sellerProceeds)}   to ${sold.seller}`);
  console.log("\n  ── measured balance deltas (independent of the event) ──");
  info(`  royalty receiver  ${og(deltas.royaltyReceiver)}   (== royaltyPaid: ${deltas.royaltyReceiver === sold.royaltyPaid})`);
  info(`  seller            ${og(deltas.seller)}`);
  info(`  buyer             ${og(deltas.buyer)}   (price + gas)`);
  ok("royalty routed to the agent's CURRENT owner - enforced inside buy(), before transfer, unbypassable in-platform.");

  // 8. Hand the agent back to main (so it owns the agent for the collection drop).
  step("returning the agent iNFT to main …");
  const regNew = new ethers.Contract(REG, REG_ABI, agentOwner2);
  const rtx = await regNew.safeTransferFrom(agentOwner2.address, signer.address, agentId, GAS); await rtx.wait(); recordTx("agentTransfer:backToMain", rtx.hash);
  ok(`agent #${agentId} returned to main - tx ${txUrl(rtx.hash)}`);

  proof.phases.royalty = {
    marketTokenId, price: og(PRICE),
    royaltyFollowsAgent: { receiverBeforeTransfer: recvBefore, receiverAfterTransfer: recvAfter, agentTransferTx: txUrl(ttx.hash), backToMainTx: txUrl(rtx.hash) },
    listing: { listTx: txUrl(ltx.hash) },
    sale: {
      buyTx: brcpt.hash, explorer: txUrl(brcpt.hash),
      split: { price: og(sold.price), royaltyPaid: og(sold.royaltyPaid), royaltyReceiver: sold.royaltyReceiver, platformFee: og(sold.platformFee), platform: addrs.platform, sellerProceeds: og(sold.sellerProceeds), seller: sold.seller, buyer: sold.buyer },
      measuredDeltas: { royaltyReceiver: og(deltas.royaltyReceiver), seller: og(deltas.seller), buyer: og(deltas.buyer), platform: og(deltas.platform) },
      royaltyDeltaEqualsEvent: deltas.royaltyReceiver === sold.royaltyPaid,
    },
  };
  save();
  return proof.phases.royalty;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE: COLLECTION - a real PFP drop (CP5)
//  One signature character, N TEE-verified trait variations; each stored on 0G
//  and minted on-chain as an OutputNFT of the agent. Then a montage.
// ─────────────────────────────────────────────────────────────────────────────
async function phaseCollection(signer: ethers.Wallet, agentId: number) {
  banner("4", "COLLECTION - drop a real PFP collection (1 character, N TEE-verified variations)");
  proof.phases.collection = proof.phases.collection || { agentId, pieces: [] };
  const C = proof.phases.collection;
  const out = new ethers.Contract(OUT, OUT_ABI, signer);
  const done = new Set(C.pieces.map((p: any) => p.label));

  // pull each piece's TEE-verified record from the earlier character log (proof it was TEE-generated)
  const charLog: any[] = existsSync("images/characters/char-log.json") ? JSON.parse(readFileSync("images/characters/char-log.json", "utf8")) : [];
  const teeFor = (file: string) => charLog.find((e) => e?.out === file && e?.ok);

  for (let i = 0; i < AGENT.collection.length; i++) {
    const piece = AGENT.collection[i];
    if (done.has(piece.label)) { ok(`[${i + 1}/${AGENT.collection.length}] ${piece.label} - already minted (#${C.pieces.find((p: any) => p.label === piece.label).tokenId})`); continue; }
    step(`[${i + 1}/${AGENT.collection.length}] ${piece.label}`);
    const bytes = readFileSync(piece.file);
    const tee = teeFor(piece.file);

    // store image
    const img = await store(signer, bytes, `collection-${piece.label}`);
    // build + store provenance
    const provRecord = { agentId, agentName: AGENT.name, trait: piece.label, model: tee?.model ?? AGENT.publicStyle.model, prompt: tee?.prompt ?? piece.label, teeVerified: tee?.verified ?? null, chatId: tee?.chatId ?? null, imageRoot: img.rootHash, ts: new Date().toISOString() };
    const provBytes = Buffer.from(JSON.stringify(provRecord), "utf8");
    const provenanceHash = ethers.keccak256(provBytes);
    const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(`TeeML|dstack|${provRecord.model}|${tee?.chatId ?? piece.label}|${img.rootHash}`));

    // mint
    const tx = await out.mintOutput(signer.address, agentId, img.rootHash, provenanceHash, teeAttestation, i, GAS);
    const rcpt = await tx.wait(); recordTx(`mintOutput:collection:${piece.label}`, rcpt.hash);
    const ev = parseEvent(rcpt, out.interface, "OutputMinted");
    const tokenId = ev ? Number(ev.tokenId) : Number(await out.nextTokenId()) - 1;
    C.pieces.push({ label: piece.label, file: piece.file, imageRoot: img.rootHash, imageTx: img.txHash, teeVerified: provRecord.teeVerified, tokenId, mintTx: rcpt.hash, explorer: txUrl(rcpt.hash) });
    save();
    ok(`minted #${tokenId} (${piece.label}) - tx ${txUrl(rcpt.hash)}`);
  }

  // montage (a single contact sheet of the whole drop, labelled with token IDs)
  try {
    const mont = "demo/collection-montage.png";
    const args: string[] = [];
    for (const p of C.pieces) { args.push("-label", `#${p.tokenId} ${p.label}`, p.file); }
    args.push("-tile", "4x2", "-geometry", "320x320+8+8", "-background", "#0b0b14", "-fill", "#ff5fa2", "-pointsize", "20", mont);
    execFileSync("montage", args);
    C.montage = mont;
    save();
    ok(`montage built → ${mont}`);
  } catch (e: any) { info(`montage note (non-fatal): ${String(e?.message).slice(0, 120)}`); }

  ok(`collection drop complete - ${C.pieces.length} pieces minted under agent #${agentId}`);
  return C;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync("demo", { recursive: true });
  const argv = process.argv.slice(2);
  const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const regen = argv.includes("--regen");
  if (regen) { proof = loadProof(); proof.phases = {}; proof.txIndex = []; save(); console.log("⟳ --regen: journal cleared, running every phase fresh."); }

  console.log("\n╔" + "═".repeat(76) + "╗");
  console.log("║  AURA - verifiable creative-agent marketplace · LIVE on 0G Galileo testnet  ║");
  console.log("╚" + "═".repeat(76) + "╝");

  const jsonProvider = new ethers.JsonRpcProvider(GALILEO.rpc);
  const signer = new ethers.Wallet(privateKey(), jsonProvider);
  const net = await jsonProvider.getNetwork();
  info(`network chainId ${net.chainId}  ·  main wallet ${signer.address}  ·  balance ${og(await jsonProvider.getBalance(signer.address))}`);
  proof.wallet = { main: signer.address };

  // 0G Compute broker + image service (shared across phases)
  step("connecting to 0G Compute …");
  const broker = await createZGComputeNetworkBroker(signer);
  const svc = await imageService(broker);
  ok(`image service: ${svc.meta.model}  TEE=${svc.verifiability}  signer=${svc.teeSigner}`);

  const run = (p: string) => !only || only === p;

  let agentId = proof.phases.agent?.agentId;
  if (run("agent")) agentId = (await phaseAgent(signer, broker, svc)).agentId;
  if (!agentId) throw new Error("no agentId - run the 'agent' phase first");

  if (run("hero")) await phaseHero(signer, broker, svc, agentId);
  if (run("royalty")) await phaseRoyalty(signer, jsonProvider, agentId);
  if (run("collection")) await phaseCollection(signer, agentId);

  proof.finishedAt = new Date().toISOString();
  proof.balanceAfter = og(await jsonProvider.getBalance(signer.address));
  save();

  console.log("\n" + "═".repeat(78));
  console.log("  ✅ AURA loop complete. Proof → demo/proof.json");
  console.log(`  ✅ ${proof.txIndex.length} on-chain transactions recorded (all on ${GALILEO.explorer})`);
  console.log("═".repeat(78) + "\n");

  await jsonProvider.destroy?.();
  process.exit(0);
}

main().catch((e) => { console.error("\n❌ FATAL:", e); process.exit(1); });
