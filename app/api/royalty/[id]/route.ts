import { NextResponse } from "next/server";
import { getRoyalty } from "@/lib/aura/royalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: "invalid token id" }, { status: 400 });
  }
  try {
    const royalty = await getRoyalty(tokenId);
    if (!royalty) return NextResponse.json({ error: `output #${tokenId} not found on-chain` }, { status: 404 });
    return NextResponse.json(royalty);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
