// Network-keyed AURA contract set for the /proof evidence panel, SELECTED by APP_CHAIN.
//
// Why a table here (not an import of contracts/deployed-v2.json): the web Docker build context is web/-only
// (deploy/web.Dockerfile: "Build context = web/, self-contained"), so the deployed manifest cannot be
// imported at build time. This table mirrors contracts/deployed-v2.json 1:1 - MAINNET = its top-level 0G
// Aristotle 16661 cutover set (2026-07-06); TESTNET = its `_rollback_testnet` 0G Galileo 16602 set - and
// APP_CHAIN picks which. So a judge on a mainnet build sees the MAINNET addresses + explorer, and the panel
// flips with the chain WITHOUT depending on every NEXT_PUBLIC_* contract build-arg being threaded (the
// Dockerfile itself notes those were silently dropped before). Keep in lockstep with deployed-v2.json.
import { APP_CHAIN, zgMainnet } from "./chains";

export type ProofContract = { label: string; addr: string; note: string };

// 0G Aristotle MAINNET 16661 - contracts/deployed-v2.json top-level (agentRegistry is 0x0: agents now live on
// the real ERC-7857 AuraINFT). Order = identity first, then the marketplace/summon economy, then the game layer.
const MAINNET_CONTRACTS: ProofContract[] = [
  { label: "AuraINFT", addr: "0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b", note: "ERC-7857 sealed-key iNFT · every Aura's on-chain identity" },
  { label: "OutputNFT", addr: "0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805", note: "attestation-gated Relic mint · on-chain TEE-verify" },
  { label: "Marketplace", addr: "0x2ad71120b1Da7d187883826980b5244F1c365Dba", note: "EIP-2981 royalty-honoring trades" },
  { label: "SummonEscrow", addr: "0x8F5978Fb86A9fF20Fe30B561F6d1a1AE04D1DC1A", note: "demand-pull commissioning + fee split" },
  { label: "ArenaVote", addr: "0x7557C716C7F1b7179506609241Fb2842c17fB92f", note: "on-chain arena battle voting" },
  { label: "AuraFusion", addr: "0x0D8b6ef3427573d673d7d1DFf8199aE00af317e9", note: "two Auras fuse into a genome-blended child" },
  { label: "ArenaReputation", addr: "0x12f094DFa0eFB1C132E1fDFFa95262a3a8ae1695", note: "Glicko reputation from arena outcomes" },
  { label: "PersonhoodGate", addr: "0x54E8496EDDc6eeD590d5e1c69C8c6949a42f90e5", note: "one-human-one-vote gate for the arena" },
];

// 0G Galileo TESTNET 16602 - contracts/deployed-v2.json `_rollback_testnet` (+ the isolated AuraINFT deploy the
// pre-cutover panel showed). Retained so a rollback build (NEXT_PUBLIC_AURA_CHAIN_ID=16602) shows testnet truth.
const TESTNET_CONTRACTS: ProofContract[] = [
  { label: "AgentRegistry", addr: "0xb5960cc08caa5195095cfb8aa270f122be09ba0a", note: "every Aura's on-chain identity (ERC-721)" },
  { label: "OutputNFT", addr: "0xEecED1e6965f00a5f7cA459631370c886FAEFd3b", note: "attestation-gated Relic mint" },
  { label: "Marketplace", addr: "0x815115Eb39987d3fAdb3b373f89fa0096433f228", note: "EIP-2981 royalty-honoring trades" },
  { label: "SummonEscrow", addr: "0xa5CeFBc097d84beE09b12fc1569B6CcA56992838", note: "demand-pull commissioning + fee split" },
  { label: "AuraINFT", addr: "0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d", note: "ERC-7857 sealed-key transfer · isolated deploy" },
];

export const PROOF_IS_MAINNET = APP_CHAIN.id === zgMainnet.id;
export const PROOF_CONTRACTS: ProofContract[] = PROOF_IS_MAINNET ? MAINNET_CONTRACTS : TESTNET_CONTRACTS;

// Named lookups the /proof page needs directly (index-independent: the two sets differ in length + order).
export const PROOF_OUTPUT_NFT = PROOF_CONTRACTS.find((c) => c.label === "OutputNFT")!.addr;
export const PROOF_AURA_INFT = PROOF_CONTRACTS.find((c) => c.label === "AuraINFT")!.addr;
// The public RPC for the cast self-check commands, network-aware (follows APP_CHAIN).
export const PROOF_RPC = APP_CHAIN.rpcUrls.default.http[0];
