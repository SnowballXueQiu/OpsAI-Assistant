import { NextResponse } from "next/server";
import { nextCommandTask } from "@/lib/commandTasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { hostname?: string };
  const hostname = body.hostname?.trim();
  if (!hostname) {
    return NextResponse.json({ error: "hostname is required" }, { status: 400 });
  }

  return NextResponse.json({
    task: nextCommandTask(hostname)
  });
}
