// SERVER-ONLY. THE critical integration: sign the EIP-712 MintAuth the deployed OutputNFT verifies.
//
// The backend wallet (= the contract's `attestor`, 0x2537...5540) signs MintAuth over the EXACT mint
// params. The user submits mintOutput themselves with these args + this sig; the contract recovers the
// signer and reverts unless it == attestor (and the nonce is unused). This binds every on-chain artwork
// to a TEE-attested off-chain generation (consent + provenance) with a per-signature replay guard.
//
// PROVEN during recon: viem hashTypedData with `nonce: uint256` (the bytes32 value passed as a bigint)
// produces a digest byte-identical to the deployed contract's authDigest(), and the recovered signer
// equals the on-chain attestor. The typehash declares `uint256 nonce` but the fn arg is bytes32 - both
// abi.encode to the same 32 bytes, so this is correct and contract-accepted.
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import { EIP712_DOMAIN } from "./config.js";
import { attestorPrivateKey } from "./config.js";

// The MintAuth type - field order + types MUST mirror the contract's MINTAUTH_TYPEHASH string:
// "MintAuth(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,uint256 nonce)"
export const MINT_AUTH_TYPES = {
  MintAuth: [
    { name: "to", type: "address" },
    { name: "creatorAgentId", type: "uint256" },
    { name: "imageRoot", type: "string" },
    { name: "provenanceHash", type: "bytes32" },
    { name: "teeAttestation", type: "bytes32" },
    { name: "seed", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const MINT_AUTH_PRIMARY = "MintAuth" as const;

export interface MintAuthParams {
  to: `0x${string}`;
  creatorAgentId: bigint;
  imageRoot: string;
  provenanceHash: `0x${string}`;
  teeAttestation: `0x${string}`;
  seed: bigint;
  nonce: `0x${string}`; // bytes32 hex; signed as a uint256 (same 32 bytes)
}

let _account: ReturnType<typeof privateKeyToAccount> | null = null;
function attestorAccount() {
  // B-6: the attestor key is now its OWN accessor (attestorPrivateKey()), which falls back to the sponsor
  // key only when ATTESTOR_PRIVATE_KEY is unset. This account is SIGN-ONLY (signTypedData below) and is
  // never used to send a tx, so the attestor key stays off the gas-spending path when split from sponsor.
  if (!_account) _account = privateKeyToAccount(attestorPrivateKey() as `0x${string}`);
  return _account;
}

/** The attestor's address (the contract attestor; defaults to the sponsor address until the key is split). */
export function attestorAddress(): string {
  return attestorAccount().address;
}

function toMessage(p: MintAuthParams) {
  return {
    to: p.to,
    creatorAgentId: p.creatorAgentId,
    imageRoot: p.imageRoot,
    provenanceHash: p.provenanceHash,
    teeAttestation: p.teeAttestation,
    seed: p.seed,
    nonce: BigInt(p.nonce), // bytes32 -> uint256 (byte-identical), matches the contract typehash
  };
}

/** Sign MintAuth -> a signature the deployed OutputNFT.mintOutput will accept. */
export async function signMintAuth(p: MintAuthParams): Promise<`0x${string}`> {
  return attestorAccount().signTypedData({
    domain: EIP712_DOMAIN,
    types: MINT_AUTH_TYPES,
    primaryType: MINT_AUTH_PRIMARY,
    message: toMessage(p),
  });
}

/** Local EIP-712 digest (matches the contract authDigest) - used by the verify scripts. */
export function mintAuthDigest(p: MintAuthParams): `0x${string}` {
  return hashTypedData({
    domain: EIP712_DOMAIN,
    types: MINT_AUTH_TYPES,
    primaryType: MINT_AUTH_PRIMARY,
    message: toMessage(p),
  });
}

/** The eip712 block returned to clients (so a wallet/SDK can re-derive + verify the same digest). */
export function eip712Block(p: MintAuthParams) {
  return {
    domain: {
      name: EIP712_DOMAIN.name,
      version: EIP712_DOMAIN.version,
      chainId: EIP712_DOMAIN.chainId,
      verifyingContract: EIP712_DOMAIN.verifyingContract,
    },
    types: MINT_AUTH_TYPES as unknown as Record<string, { name: string; type: string }[]>,
    primaryType: MINT_AUTH_PRIMARY as string,
    message: {
      to: p.to,
      creatorAgentId: p.creatorAgentId.toString(),
      imageRoot: p.imageRoot,
      provenanceHash: p.provenanceHash,
      teeAttestation: p.teeAttestation,
      seed: p.seed.toString(),
      nonce: p.nonce,
    },
  };
}
