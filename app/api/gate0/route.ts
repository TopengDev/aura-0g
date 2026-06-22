// GATE 0 SMOKE-TEST — prove the 0G SDKs (Compute broker + Storage indexer) actually
// LOAD and EXECUTE inside a Next.js route handler on the NODE runtime. Read-only / fund-free:
//   • Compute: construct the broker (CJS-required) + listService() (on-chain read, no spend)
//   • Storage: construct the Indexer + getShardedNodes() (reachability) + a local merkle root
// No funds spent, no tx sent. If this returns ok:true, the monolith assumption holds.
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { GALILEO, mainPrivateKey } from "@/lib/aura/config";
import { createZGComputeNetworkBroker } from "@/lib/aura/zg-compute";

export const runtime = "nodejs"; // MUST be nodejs (not edge) — native/CJS deps.
export const dynamic = "force-dynamic";

export async function GET() {
  const result: Record<string, unknown> = { runtime: "nodejs", startedAt: new Date().toISOString() };

  // ── 0G COMPUTE: broker construction + service listing (read-only) ──
  try {
    const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
    const wallet = new ethers.Wallet(mainPrivateKey(), provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    const services = await broker.inference.listService();
    const img = services.find(
      (s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image",
    );
    result.compute = {
      ok: true,
      brokerConstructed: true,
      serviceCount: services.length,
      imageService: img
        ? { model: img.model, type: img.serviceType, provider: img.provider, verifiability: img.verifiability, teeSigner: img.teeSignerAddress }
        : null,
    };
    await provider.destroy?.();
  } catch (e: any) {
    result.compute = { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }

  // ── 0G STORAGE: indexer reachability + local merkle root (fund-free) ──
  try {
    const { Indexer, MemData } = await import("@0gfoundation/0g-ts-sdk");
    const indexer = new Indexer(GALILEO.storageIndexerTurbo);
    const payload = Buffer.from(JSON.stringify({ gate0: true, ts: new Date().toISOString() }), "utf8");
    const mem = new MemData(payload);
    const [tree, mErr] = await mem.merkleTree();
    if (mErr) throw mErr;
    const localRoot = tree?.rootHash();
    let nodes = "unknown";
    try {
      const sharded: any = await indexer.getShardedNodes();
      nodes = sharded?.trusted?.length ?? sharded?.length ?? "reachable";
    } catch (e: any) {
      nodes = `reachability-note: ${String(e?.message ?? e).slice(0, 120)}`;
    }
    result.storage = { ok: true, sdkLoaded: true, localMerkleRoot: localRoot, payloadBytes: payload.length, shardedNodes: nodes };
  } catch (e: any) {
    result.storage = { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }

  const computeOk = (result.compute as any)?.ok === true;
  const storageOk = (result.storage as any)?.ok === true;
  result.ok = computeOk && storageOk;
  result.finishedAt = new Date().toISOString();

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
