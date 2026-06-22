import { NextResponse } from "next/server";
import { listAgents } from "@/lib/aura/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json({ agents, count: agents.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
