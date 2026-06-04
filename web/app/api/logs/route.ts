import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = getSnapshot();
  return NextResponse.json({
    logs: snapshot.latest?.logs ?? "",
    alerts: snapshot.alerts
  });
}

