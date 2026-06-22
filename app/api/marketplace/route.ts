import { NextResponse } from "next/server";
import { getMarketplace } from "@/lib/aura/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/marketplace — platform info, live listings, and the proven royalty-follows-agent sale.
export async function GET() {
  try {
    const view = await getMarketplace();
    return NextResponse.json(view);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

// POST /api/marketplace — list/buy as live mutations are deferred (Phase 1 scope). The royalty
// economics are proven on-chain; see GET /api/marketplace -> royaltyDemo.
export async function POST() {
  return NextResponse.json(
    {
      error: "list/buy live mutations are out of scope for Phase 1 (the wedge is agents→generate→mint→provenance→royalty→collection).",
      provenOnChain: "The enforced royalty-follows-agent SALE is already proven on-chain — see GET /api/marketplace -> royaltyDemo.",
    },
    { status: 501 },
  );
}
