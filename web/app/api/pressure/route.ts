import { NextResponse } from "next/server";
import { enqueuePressureTask, type PressureTarget, waitForCommandResults } from "@/lib/commandTasks";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { target?: PressureTarget; action?: "start" | "stop" };
  if (body.target !== "cpu" && body.target !== "memory" && body.target !== "disk") {
    return NextResponse.json({ error: "target must be cpu, memory or disk" }, { status: 400 });
  }
  if (body.action !== "start" && body.action !== "stop") {
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
  }

  const snapshot = getSnapshot();
  if (!snapshot.latest) {
    return NextResponse.json({ error: "尚未收到真实 probe 数据，无法下发压力任务。" }, { status: 409 });
  }

  const task = enqueuePressureTask(snapshot.latest.hostname, body.target, body.action);
  const [result] = await waitForCommandResults([task.id], 12000);
  if (!result) {
    return NextResponse.json({ error: "probe 未在等待时间内返回压力任务结果。" }, { status: 504 });
  }

  return NextResponse.json({
    ok: result.exitCode === 0,
    target: body.target,
    action: body.action,
    result
  }, { status: result.exitCode === 0 ? 200 : 500 });
}
