// SERVER-ONLY. The two-layer memory CORE (M1): manifest + two sub-manifests + two keyrings + append/read.
//
// One mechanism (the spike's append-only, immutable, content-addressed segments under epoch keys), two
// layers, two keyrings. A MemoryService owns the canonical manifest, the INTRINSIC key escrow (server
// custody — needed to re-seal on sale), and the segment backend. RELATIONSHIP keys are NOT escrowed
// (no-escrow hardening): the owner unseals their current L2 key client-side and hands the raw key to the
// L2 writer. Reads are pure functions over (manifest, backend, owner privkey): a segment whose epoch key
// the owner cannot unseal contributes ZERO records — the wall, enforced at the loader by key custody.
import { sealSegment, tryOpenSegment } from "./segment.js";
import { rootOf, type SegmentBackend } from "./local-store.js";
import { newEpochKey, sealEpochKey, openKeyring, type RawKeyring } from "./keyring.js";
import type {
  Epoch,
  Layer,
  Manifest,
  MemoryRecord,
  IntrinsicRecord,
  RelationshipRecord,
  SegRef,
} from "./types.js";

export interface CreateAgentMemoryInput {
  agentId: string;
  ownerAddr: string;
  ownerPubkey: string; // uncompressed secp256k1 pubkey (recovered SIWE-style, pubkey.ts)
  backend: SegmentBackend;
}

export class MemoryService {
  readonly manifest: Manifest;
  /** Raw INTRINSIC epoch keys — server custody (escrow). Required to re-seal all of L1 to a buyer. */
  readonly intrinsicEscrow: RawKeyring;
  private readonly backend: SegmentBackend;
  private seq = 0;

  private constructor(manifest: Manifest, escrow: RawKeyring, backend: SegmentBackend) {
    this.manifest = manifest;
    this.intrinsicEscrow = escrow;
    this.backend = backend;
  }

  /**
   * Seed a brand-new agent's memory at epoch 0 for BOTH layers.
   * Returns the service + the raw L2 epoch-0 key handed to the owner (no-escrow: the service does not keep
   * it). In production the owner would unseal it from the manifest client-side; we return it for the PoC.
   */
  static create(input: CreateAgentMemoryInput): { service: MemoryService; ownerL2Key: Buffer } {
    const { agentId, ownerAddr, ownerPubkey, backend } = input;
    const epoch: Epoch = 0;

    const l1Key = newEpochKey();
    const l2Key = newEpochKey();
    const escrow: RawKeyring = new Map([[epoch, l1Key]]); // ONLY intrinsic is escrowed

    const manifest: Manifest = {
      agentId,
      currentEpoch: epoch,
      owner: ownerAddr.toLowerCase(),
      intrinsic: { segments: [], keyring: { [epoch]: sealEpochKey(ownerPubkey, l1Key) } },
      relationship: { segments: [], keyring: { [epoch]: sealEpochKey(ownerPubkey, l2Key) } },
    };
    return { service: new MemoryService(manifest, escrow, backend), ownerL2Key: l2Key };
  }

  private async appendSegment(layer: Layer, epochKey: Buffer, records: MemoryRecord[]): Promise<SegRef> {
    if (records.length === 0) throw new Error("appendSegment: refusing to write an empty segment");
    const epoch = this.manifest.currentEpoch;
    const envelope = sealSegment(epochKey, records);
    const root = await this.backend.store(envelope);
    const ref: SegRef = {
      id: `${this.manifest.agentId}/${layer}/${epoch}/${this.seq++}`,
      layer,
      epoch,
      root,
      dataHash: rootOf(envelope), // == root here (one addressing scheme); explicit for tamper-evidence
      count: records.length,
    };
    this.manifest[layer].segments.push(ref);
    return ref;
  }

  /** Append Layer-1 INTRINSIC records under the current epoch (server uses its escrow key). */
  async appendIntrinsic(records: IntrinsicRecord[]): Promise<SegRef> {
    const key = this.intrinsicEscrow.get(this.manifest.currentEpoch);
    if (!key) throw new Error(`appendIntrinsic: no escrow key for epoch ${this.manifest.currentEpoch}`);
    return this.appendSegment("intrinsic", key, records);
  }

  /** Append Layer-2 RELATIONSHIP records under the current epoch (owner supplies the raw L2 key). */
  async appendRelationship(records: RelationshipRecord[], rawL2Key: Buffer): Promise<SegRef> {
    return this.appendSegment("relationship", rawL2Key, records);
  }
}

/**
 * Read every record in a layer that the owner's keyring can open. The dual wall lives HERE: a segment
 * whose epoch key is absent from (or unopenable in) this manifest's keyring yields nothing. There is no
 * plaintext for a buggy or adversarial loader to leak — the bytes are opaque AES-GCM without the key.
 */
export async function readLayer(
  manifest: Manifest,
  layer: Layer,
  ownerPrivkeyHex: string,
  backend: SegmentBackend,
): Promise<MemoryRecord[]> {
  const raw: RawKeyring = openKeyring(ownerPrivkeyHex, manifest[layer].keyring);
  const out: MemoryRecord[] = [];
  for (const ref of manifest[layer].segments) {
    const key = raw.get(ref.epoch);
    if (!key) continue; // no key for this epoch -> structurally unreadable
    const env = await backend.download(ref.root);
    const recs = tryOpenSegment(key, env); // null if the key cannot open it (the wall, soft)
    if (recs) out.push(...recs);
  }
  return out;
}

export async function readIntrinsic(m: Manifest, priv: string, b: SegmentBackend): Promise<IntrinsicRecord[]> {
  return (await readLayer(m, "intrinsic", priv, b)) as IntrinsicRecord[];
}
export async function readRelationship(m: Manifest, priv: string, b: SegmentBackend): Promise<RelationshipRecord[]> {
  return (await readLayer(m, "relationship", priv, b)) as RelationshipRecord[];
}
