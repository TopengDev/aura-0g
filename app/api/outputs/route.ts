import { NextResponse } from "next/server";
import { listOutputs } from "@/lib/aura/outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const outputs = await listOutputs();
    return NextResponse.json({ outputs, count: outputs.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
