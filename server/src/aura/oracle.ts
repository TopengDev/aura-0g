// SERVER-ONLY. The ERC-7857 TRUSTED RE-ENCRYPTION ORACLE (the second half of the de-mock).
//
// THE MOCK THIS REPLACES: AgentRegistry.transfer(to,tokenId,proofs) ignored its `proofs` and fell back
// to a plain ERC721 transfer - the brain was never re-keyed and the contract verified nothing. Here the
// oracle performs the REAL re-encryption: it takes the current AES data-key, generates a FRESH key,
// re-encrypts the brain envelope, ECIES-seals the new key to the BUYER's pubkey, and signs an EIP-191
// transfer proof that AuraINFT.transfer() recovers against its `oracleAddress`.
//
// TRUST MODEL (HONEST): this is a TRUSTED ECDSA SIGNER, NOT a hardware-TEE enclave. It mirrors mainnet
// ZeroArena's ReencryptionOracle (a trusted off-chain signer with an ORACLE_PRIVATE_KEY). A genuine TEE
// re-encryption oracle is nobody's shipped reality yet (0G included). The oracle key is dedicated
// (ORACLE_PRIVATE_KEY) and falls back to the sponsor key only for local/dev convenience.
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { encryptBrain, decryptBrain, type BrainPlain } from "./brain.js";
import { sealKeyToPubkey } from "./sealing.js";
import { oraclePrivateKey } from "./config.js";

/** sha256 of the on-storage envelope = the contract's dataHash (matches the PoC + AuraINFT). */
export function dataHashOf(envelope: Buffer): `0x${string}` {
  return ("0x" + createHash("sha256").update(envelope).digest("hex")) as `0x${string}`;
}

let _oracle: ethers.Wallet | null = null;
function oracleWallet(): ethers.Wallet {
  // B-6: use the dedicated ORACLE accessor (oraclePrivateKey()), which falls back to the sponsor key only
  // when ORACLE_PRIVATE_KEY is unset. Splitting it keeps the de-mock re-encryption signer off the shared
  // attestor/sponsor key so a single leak cannot forge transfer proofs AND mint attestations AND drain gas.
  if (!_oracle) _oracle = new ethers.Wallet(oraclePrivateKey());
  return _oracle;
}

/** The oracle's address - this is what AuraINFT.oracle must be set to. */
export function oracleAddress(): string {
  return oracleWallet().address;
}

export interface ReencryptInput {
  inft: string;            // the AuraINFT contract address (binds the proof)
  chainId: number;         // binds the proof (replay isolation across chains)
  tokenId: bigint;
  from: string;            // current owner
  to: string;              // new owner
  toPubkey: string;        // new owner's secp256k1 pubkey (for ECIES sealing)
  currentEnvelope: Buffer; // the current encrypted brain envelope (iv||tag||ct)
  currentKeyHex: string;   // the current AES data-key (server custody today)
  deadlineSec: number;     // proof expiry (unix seconds)
}

export interface ReencryptResult {
  newEnvelope: Buffer;     // re-encrypted brain (re-upload to 0G Storage in the full version)
  newKeyHex: string;       // the fresh AES key (server re-custody)
  newDataHash: `0x${string}`;
  sealedKey: Buffer;       // the fresh key ECIES-sealed to the BUYER
  proof: `0x${string}`;    // oracle's EIP-191 signature AuraINFT.transfer() verifies
  digest: `0x${string}`;   // the raw tuple hash the proof signs (toEthSignedMessageHash)
}

/**
 * Re-encrypt a brain for a new owner and produce the on-chain transfer proof.
 *
 * Faithful to ERC-7857's trusted-signer mode: obtain the current key (server custody), decrypt, generate
 * a FRESH key, re-encrypt, seal to the buyer, sign. The fresh key + fresh envelope guarantee the OLD
 * owner's key cannot decrypt the new data (forward secrecy of custody), and only the buyer can open the
 * new sealed key. The proof digest MUST match AuraINFT.transferProofDigest exactly.
 */
export async function reencryptForTransfer(input: ReencryptInput): Promise<ReencryptResult> {
  // 1. obtain the current data-key + decrypt the brain (server custody hands the oracle the key today).
  const brain: BrainPlain = decryptBrain(input.currentEnvelope, input.currentKeyHex);

  // 2. FRESH key + re-encrypt -> new envelope (the OLD key cannot open this).
  const { envelope: newEnvelope, keyHex: newKeyHex } = encryptBrain(brain);
  const newDataHash = dataHashOf(newEnvelope);
  const newKey = Buffer.from(newKeyHex.replace(/^0x/, ""), "hex");

  // 3. ECIES-seal the fresh key to the BUYER's pubkey (only the buyer's wallet can open it).
  const sealedKey = sealKeyToPubkey(input.toPubkey, newKey);

  // 4. EIP-191 transfer proof over the EXACT tuple AuraINFT.transfer() reconstructs + recovers.
  const digest = ethers.solidityPackedKeccak256(
    ["uint256", "address", "uint256", "address", "address", "bytes32", "bytes32", "uint256"],
    [
      BigInt(input.chainId),
      input.inft,
      input.tokenId,
      input.from,
      input.to,
      ethers.keccak256(sealedKey),
      newDataHash,
      BigInt(input.deadlineSec),
    ],
  ) as `0x${string}`;
  const proof = (await oracleWallet().signMessage(ethers.getBytes(digest))) as `0x${string}`;

  return { newEnvelope, newKeyHex, newDataHash, sealedKey, proof, digest };
}
