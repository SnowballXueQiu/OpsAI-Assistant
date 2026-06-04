import { NextResponse } from "next/server";
import { addMetric, clearMetrics, getSnapshot } from "@/lib/store";
import type { ProbePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSnapshot());
}

export async function POST(request: Request) {
  const payload = await request.json() as ProbePayload;
  if (!payload.hostname || typeof payload.cpu?.usagePercent !== "number") {
    return NextResponse.json({ error: "invalid probe payload" }, { status: 400 });
  }
  const record = addMetric(payload);
  return NextResponse.json({ ok: true, record });
}

export async function DELETE() {
  clearMetrics();
  return NextResponse.json({ ok: true });
}
