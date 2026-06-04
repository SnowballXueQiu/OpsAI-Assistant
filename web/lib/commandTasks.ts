import type { CommandResult, DashboardSnapshot } from "./types";

type CommandTask = CommandResult & {
  status: "pending" | "running" | "done";
};

const globalTasks = globalThis as unknown as {
  __opsaiCommandTasks?: CommandTask[];
};

const allowedCommands = new Map<string, string>([
  ["cpu_top", "top -b -n 1 | head -20"],
  ["cpu_ps", "ps aux --sort=-%cpu | head -10"],
  ["load_uptime", "uptime"],
  ["vmstat", "vmstat 1 3"],
  ["iostat", "iostat -dx 1 2"],
  ["journal_warnings", "journalctl -p warning..alert --since '10 minutes ago' -n 30 --no-pager"],
  ["ssh_recent", "journalctl -u ssh --since '30 minutes ago' -n 30 --no-pager"],
  ["pressure_cpu_start", "opsai:pressure:cpu:start"],
  ["pressure_cpu_stop", "opsai:pressure:cpu:stop"],
  ["pressure_memory_start", "opsai:pressure:memory:start"],
  ["pressure_memory_stop", "opsai:pressure:memory:stop"],
  ["pressure_disk_start", "opsai:pressure:disk:start"],
  ["pressure_disk_stop", "opsai:pressure:disk:stop"]
]);

function tasks() {
  if (!globalTasks.__opsaiCommandTasks) globalTasks.__opsaiCommandTasks = [];
  return globalTasks.__opsaiCommandTasks;
}

export function buildDiagnosticPlan(question: string, snapshot: DashboardSnapshot) {
  const lower = question.toLowerCase();
  const latest = snapshot.latest;
  const plan: Array<{ label: string; command: string }> = [];

  function add(key: string, label: string) {
    const command = allowedCommands.get(key);
    if (command) plan.push({ label, command });
  }

  if (/cpu|负载|占用高|卡|慢/.test(lower) || (latest?.cpu.usagePercent ?? 0) >= 70) {
    add("cpu_top", "实时 top 进程快照");
    add("cpu_ps", "按 CPU 排序的进程列表");
    add("load_uptime", "系统负载概览");
    add("vmstat", "CPU 与运行队列采样");
  }

  if (/磁盘|io|i\/o|空间|卡/.test(lower)) {
    add("iostat", "磁盘 I/O 采样");
  }

  if (/ssh|日志|登录|失败|异常|error|failed/.test(lower) || snapshot.alerts.some((item) => /日志|SSH|错误|失败/.test(item))) {
    add("journal_warnings", "近期系统告警日志");
    add("ssh_recent", "近期 SSH 日志");
  }

  if (plan.length === 0) {
    add("cpu_top", "实时 top 进程快照");
    add("cpu_ps", "按 CPU 排序的进程列表");
    add("journal_warnings", "近期系统告警日志");
  }

  return plan.slice(0, 6);
}

export function enqueueCommandTasks(hostname: string, plan: Array<{ label: string; command: string }>) {
  const now = new Date().toISOString();
  const data = tasks();
  const created = plan.map((item, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    hostname,
    label: item.label,
    command: item.command,
    output: "",
    exitCode: -1,
    status: "pending" as const,
    createdAt: now
  }));
  data.push(...created);
  if (data.length > 200) data.splice(0, data.length - 200);
  return created;
}

export type PressureTarget = "cpu" | "memory" | "disk";

export function enqueuePressureTask(hostname: string, target: PressureTarget, action: "start" | "stop") {
  const command = allowedCommands.get(`pressure_${target}_${action}`);
  if (!command) throw new Error("pressure command not configured");
  const labelMap: Record<PressureTarget, string> = {
    cpu: "CPU",
    memory: "内存",
    disk: "磁盘"
  };
  return enqueueCommandTasks(hostname, [{
    label: `${action === "start" ? "启动" : "停止"}真实 ${labelMap[target]} 压力`,
    command
  }])[0];
}

export function nextCommandTask(hostname: string) {
  const task = tasks().find((item) => item.hostname === hostname && item.status === "pending");
  if (!task) return null;
  task.status = "running";
  return {
    id: task.id,
    label: task.label,
    command: task.command
  };
}

export function completeCommandTask(result: {
  id: string;
  hostname: string;
  output: string;
  exitCode: number;
}) {
  const task = tasks().find((item) => item.id === result.id && item.hostname === result.hostname);
  if (!task) return null;
  task.status = "done";
  task.output = result.output.slice(0, 12000);
  task.exitCode = result.exitCode;
  task.completedAt = new Date().toISOString();
  return task;
}

export async function waitForCommandResults(ids: string[], timeoutMs = 22000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = tasks().filter((item) => ids.includes(item.id) && item.status === "done");
    if (done.length === ids.length) return done.map(toPublicResult);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return tasks()
    .filter((item) => ids.includes(item.id) && item.status === "done")
    .map(toPublicResult);
}

function toPublicResult(task: CommandTask): CommandResult {
  return {
    id: task.id,
    hostname: task.hostname,
    label: task.label,
    command: task.command,
    output: task.output,
    exitCode: task.exitCode,
    createdAt: task.createdAt,
    completedAt: task.completedAt
  };
}
