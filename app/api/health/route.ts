import { NextResponse } from "next/server";
import { GALILEO, CONTRACTS } from "@/lib/aura/config";
import { genStats } from "@/lib/aura/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness + config echo (NO secrets).
export async function GET() {
  let demoConfigured = false;
  try {
    demoConfigured = Boolean(process.env.DEMO_PRIVATE_KEY);
  } catch {
    demoConfigured = false;
  }
  return NextResponse.json({
    ok: true,
    network: { name: "0G Galileo testnet", chainId: GALILEO.chainId, rpc: GALILEO.rpc, explorer: GALILEO.explorer },
    contracts: CONTRACTS,
    demoWalletConfigured: demoConfigured,
    generation: genStats(),
    ts: new Date().toISOString(),
  });
}
