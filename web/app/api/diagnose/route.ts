import { NextResponse } from "next/server";
import { buildDiagnosticPlan, enqueueCommandTasks, waitForCommandResults } from "@/lib/commandTasks";
import { diagnose } from "@/lib/ollama";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const snapshot = getSnapshot();
    if (!snapshot.latest) {
      return NextResponse.json({
        error: "尚未收到真实 Linux probe 数据。请先在虚拟机中运行 opsai-probe 并上报到 /api/metrics。"
      }, { status: 409 });
    }

    const plan = buildDiagnosticPlan(question, snapshot);
    const tasks = enqueueCommandTasks(snapshot.latest.hostname, plan);
    const commandResults = await waitForCommandResults(tasks.map((task) => task.id));
    const refreshedSnapshot = getSnapshot();
    const answer = await diagnose(question, refreshedSnapshot, commandResults);
    return NextResponse.json({
      answer,
      commands: commandResults.map((result) => ({
        label: result.label,
        command: result.command,
        exitCode: result.exitCode,
        completedAt: result.completedAt
      }))
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Ollama 响应超时，请确认本地模型已启动，或稍后重试。"
      : error instanceof Error ? error.message : "diagnose failed";
    return NextResponse.json({
      error: message
    }, { status: 502 });
  }
}
