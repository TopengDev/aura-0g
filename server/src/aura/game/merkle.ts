// SERVER-ONLY, PURE. An OpenZeppelin StandardMerkleTree-compatible builder for the season rating ladder, so
// the root the server anchors on ArenaReputation is the SAME root @openzeppelin/merkle-tree would produce and
// the on-chain ArenaReputation.verifyRating (OZ MerkleProof.verify, commutative) accepts our proofs.
//
// Two byte-locked properties vs the contract (ArenaReputation.sol):
//   1. LEAF = keccak256(bytes.concat(keccak256(abi.encode(uint256 agentId, uint32 rating, uint32 rd)))) - the
//      OZ "double-hash" standard leaf, IDENTICAL to ArenaReputation.leafOf (second-preimage safe).
//   2. Internal nodes use the COMMUTATIVE sorted-pair hash (keccak of the two 32-byte children, smaller first)
//      - IDENTICAL to OZ Hashes.commutativeKeccak256 that MerkleProof.verify runs on-chain.
// Leaves are sorted ascending by hash before the tree is built (OZ StandardMerkleTree.of), so the whole ladder
// is a canonical, deterministic function of its rows: anyone recomputes the exact root with OZ's package.
import { ethers } from "ethers";

const abi = ethers.AbiCoder.defaultAbiCoder();

export interface LadderLeafInput {
  agentId: number | bigint;
  rating: number; // uint32 (whole rating points)
  rd: number; // uint32 (whole RD points)
}

/** The OZ standard double-hash leaf == ArenaReputation.leafOf(agentId, rating, rd). */
export function standardLeafHash(row: LadderLeafInput): string {
  const inner = ethers.keccak256(abi.encode(["uint256", "uint32", "uint32"], [BigInt(row.agentId), row.rating, row.rd]));
  return ethers.keccak256(inner); // bytes.concat(single bytes32) == that bytes32, so this is keccak(keccak(encode))
}

/** Commutative pair hash (OZ Hashes.commutativeKeccak256): keccak of the two children, smaller value first. */
function hashPair(a: string, b: string): string {
  const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/** OZ makeMerkleTree: a 2n-1 flat array; leaves at the tail, each internal node = hashPair(children). */
function makeMerkleTree(leaves: string[]): string[] {
  if (leaves.length === 0) throw new Error("merkle: cannot build a tree with no leaves");
  const tree: string[] = new Array(2 * leaves.length - 1);
  for (let i = 0; i < leaves.length; i++) tree[tree.length - 1 - i] = leaves[i]!;
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) {
    tree[i] = hashPair(tree[2 * i + 1]!, tree[2 * i + 2]!);
  }
  return tree;
}

/** OZ getProof: the sibling path from a leaf's tree-index up to the root. */
function proofFromTreeIndex(tree: string[], treeIndex: number): string[] {
  const proof: string[] = [];
  let idx = treeIndex;
  while (idx > 0) {
    const sibling = idx % 2 === 1 ? idx + 1 : idx - 1;
    proof.push(tree[sibling]!);
    idx = Math.floor((idx - 1) / 2);
  }
  return proof;
}

export class LadderMerkleTree {
  private constructor(
    private readonly tree: string[],
    private readonly treeIndexByAgent: Map<string, number>,
    readonly rows: LadderLeafInput[],
  ) {}

  /** Build the canonical ladder tree from the rows (sorted ascending by leaf hash, OZ StandardMerkleTree.of). */
  static of(rows: LadderLeafInput[]): LadderMerkleTree {
    if (rows.length === 0) throw new Error("merkle: ladder has no rows");
    const hashed = rows.map((row) => ({ row, hash: standardLeafHash(row) }));
    hashed.sort((a, b) => (BigInt(a.hash) < BigInt(b.hash) ? -1 : BigInt(a.hash) > BigInt(b.hash) ? 1 : 0));
    const leaves = hashed.map((h) => h.hash);
    const tree = makeMerkleTree(leaves);
    const map = new Map<string, number>();
    hashed.forEach((h, sortedIdx) => map.set(String(h.row.agentId), tree.length - 1 - sortedIdx));
    return new LadderMerkleTree(tree, map, rows);
  }

  root(): string {
    return this.tree[0]!;
  }

  /** The Merkle proof for a given agent's leaf (for ArenaReputation.verifyRating). */
  proofFor(agentId: number | bigint): string[] {
    const idx = this.treeIndexByAgent.get(String(agentId));
    if (idx === undefined) throw new Error(`merkle: agent ${agentId} not in the ladder`);
    return proofFromTreeIndex(this.tree, idx);
  }

  /** Off-chain verify (mirrors OZ MerkleProof.verify): fold the commutative hash of leaf + proof to the root. */
  static verify(root: string, leaf: string, proof: string[]): boolean {
    let computed = leaf;
    for (const p of proof) computed = hashPair(computed, p);
    return computed.toLowerCase() === root.toLowerCase();
  }
}

/** Convenience: just the anchored root for a ladder (1 SSTORE/season on ArenaReputation.anchorSeason). */
export function ladderRoot(rows: LadderLeafInput[]): string {
  return LadderMerkleTree.of(rows).root();
}
