import { NextResponse } from "next/server";
import { getAgentById } from "@/lib/aura/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId < 1) {
    return NextResponse.json({ error: "invalid agent id" }, { status: 400 });
  }
  try {
    const agent = await getAgentById(agentId);
    if (!agent) return NextResponse.json({ error: `agent #${agentId} not found on-chain` }, { status: 404 });
    return NextResponse.json(agent);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
