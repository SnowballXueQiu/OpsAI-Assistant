import type { CommandResult, DashboardSnapshot } from "./types";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gpt-oss:latest";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 90000);

export async function diagnose(question: string, snapshot: DashboardSnapshot, commandResults: CommandResult[] = []) {
  const context = buildDiagnosticContext(question, snapshot, commandResults);
  const systemPrompt = [
    "你是Linux服务器智能运维助手。",
    "你只能根据用户提供的真实Linux probe摘要和已经执行的只读命令输出进行诊断，不能把示例、常识或猜测当成事实。",
    "必须用中文 Markdown 输出，禁止输出 JSON。",
    "不要使用 Markdown 表格，证据请用列表呈现。",
    "回答结构固定为：结论、已执行检查、证据、原因推理、解决办法、后续复核命令。",
    "如果命令输出中已经有 top/ps/vmstat/journalctl 结果，必须基于这些结果完成判断，不要再把它们作为未执行建议。",
    "后续复核命令只放少量必要命令，不能出现 watch 这种不会结束的交互命令。",
    "不要复述完整日志，只引用关键线索。"
  ].join("\n");

  const userPrompt = [
    `用户问题：${question}`,
    "",
    "真实探针诊断摘要：",
    context
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const answer = data.message?.content?.trim() ?? "";
  return looksWeakAnswer(answer) ? buildFallbackDiagnosis(context, answer) : answer;
}

function buildDiagnosticContext(question: string, snapshot: DashboardSnapshot, commandResults: CommandResult[]) {
  const latest = snapshot.latest;
  if (!latest) return "尚未收到真实 probe 数据。";

  const memoryPercent = latest.memory.totalKb > 0
    ? latest.memory.usedKb / latest.memory.totalKb * 100
    : 0;
  const diskPercent = latest.disk.totalBytes > 0
    ? (latest.disk.totalBytes - latest.disk.availableBytes) / latest.disk.totalBytes * 100
    : 0;
  const cpuHistory = snapshot.history.map((item) => item.cpu.usagePercent);
  const cpuMax = cpuHistory.length > 0 ? Math.max(...cpuHistory) : latest.cpu.usagePercent;
  const cpuAvg = cpuHistory.length > 0
    ? cpuHistory.reduce((sum, item) => sum + item, 0) / cpuHistory.length
    : latest.cpu.usagePercent;
  const highCpuSamples = cpuHistory.filter((item) => item >= 85).length;
  const logHints = latest.logs
    .split("\n")
    .filter((line) => /error|failed|failure|invalid|sshd|sudo|GPT/i.test(line))
    .slice(-8)
    .join("\n");
  const processLines = (latest.processes ?? [])
    .map((process) => `- PID ${process.pid} ${process.name}: RSS ${(process.memoryKb / 1024).toFixed(1)} MB`)
    .join("\n") || "- probe 未上报进程样本";
  const commandLines = commandResults.length > 0
    ? commandResults.map((result) => [
      `### ${result.label}`,
      `命令: ${result.command}`,
      `退出码: ${result.exitCode}`,
      "输出:",
      result.output.trim() || "(无输出)"
    ].join("\n")).join("\n\n")
    : "probe 在等待窗口内未返回命令结果，需要说明自动检查未完成。";

  return [
    `问题: ${question}`,
    `主机: ${latest.hostname}`,
    `最近上报: ${latest.receivedAt}`,
    `CPU当前: ${latest.cpu.usagePercent.toFixed(1)}%, 最近${cpuHistory.length}次平均: ${cpuAvg.toFixed(1)}%, 最高: ${cpuMax.toFixed(1)}%, 高于85%的采样数: ${highCpuSamples}`,
    `Load Average: 1分钟 ${latest.system?.loadAverage.one.toFixed(2) ?? "未知"}, 5分钟 ${latest.system?.loadAverage.five.toFixed(2) ?? "未知"}, 15分钟 ${latest.system?.loadAverage.fifteen.toFixed(2) ?? "未知"}`,
    `内存: ${memoryPercent.toFixed(1)}% (${(latest.memory.usedKb / 1024 / 1024).toFixed(2)}GB / ${(latest.memory.totalKb / 1024 / 1024).toFixed(2)}GB)`,
    `磁盘: ${diskPercent.toFixed(1)}%, 可用 ${(latest.disk.availableBytes / 1024 / 1024 / 1024).toFixed(2)}GB`,
    `规则告警: ${snapshot.alerts.join("；")}`,
    "进程样本说明: 当前 probe 只上报按内存排序的 TopN，不包含进程CPU占比。",
    "进程样本:",
    processLines,
    "已自动执行的排查命令:",
    commandLines,
    "日志关键线索:",
    logHints || "未提取到 error/failed/sshd/sudo/GPT 关键词线索"
  ].join("\n");
}

function looksWeakAnswer(answer: string) {
  if (!answer) return true;
  if (answer.length < 120) return true;
  if (/^\s*\{[\s\S]*\}\s*$/.test(answer)) return true;
  return false;
}

function buildFallbackDiagnosis(context: string, weakAnswer: string) {
  return [
    "## 结论",
    "当前诊断基于真实 probe 快照。系统已经收到 Linux 虚拟机连续上报，若 CPU 当前或最近历史超过 85%，可判断存在高 CPU 现象；但当前 probe 尚未采集进程 CPU 占比，所以不能仅凭快照直接断定具体进程。",
    "",
    "## 证据",
    context,
    "",
    "## 后续复核命令",
    "```bash",
    "top -o %CPU",
    "ps -eo pid,ppid,comm,%cpu,%mem,etime --sort=-%cpu | head -15",
    "journalctl -p warning..alert --since '10 minutes ago'",
    "journalctl -u ssh --since '30 minutes ago'",
    "uptime",
    "```",
    "",
    "## 处置建议",
    "先用 `ps` 或 `top` 找到 CPU 排名前几的进程；如果是测试脚本或异常任务，可以停止对应 PID；如果是正常业务进程，应结合日志和负载持续时间判断是否需要限流、扩容或优化任务。",
    weakAnswer ? `\n## Ollama 原始返回\n${weakAnswer}` : ""
  ].join("\n");
}
