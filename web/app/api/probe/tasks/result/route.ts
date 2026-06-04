import { NextResponse } from "next/server";
import { completeCommandTask } from "@/lib/commandTasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as {
    id?: string;
    hostname?: string;
    output?: string;
    exitCode?: number;
  };

  if (!body.id || !body.hostname || typeof body.output !== "string" || typeof body.exitCode !== "number") {
    return NextResponse.json({ error: "invalid task result" }, { status: 400 });
  }

  const task = completeCommandTask({
    id: body.id,
    hostname: body.hostname,
    output: body.output,
    exitCode: body.exitCode
  });

  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
