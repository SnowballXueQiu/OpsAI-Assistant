"use client";

import { Activity, AlertTriangle, Bot, Clock3, Cpu, Database, Flame, HardDrive, ListTree, RefreshCw, Send, Server, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { DashboardSnapshot, MetricRecord } from "@/lib/types";

type Props = {
  initialSnapshot: DashboardSnapshot;
};

const quickQuestions = [
  "为什么CPU占用高？",
  "内存是否存在压力？",
  "磁盘空间是否危险？",
  "SSH日志里有没有异常？"
];

const pressureTargets = [
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "内存" },
  { key: "disk", label: "磁盘" }
] as const;

type PressureTarget = typeof pressureTargets[number]["key"];

function percent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function kbToGb(kb: number) {
  return kb / 1024 / 1024;
}

function bytesToGb(bytes: number) {
  return bytes / 1024 / 1024 / 1024;
}

function formatUptime(seconds?: number) {
  if (!seconds) return "暂无";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

function StatCard({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "amber" | "red" | "blue";
}) {
  return (
    <section className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </section>
  );
}

function buildSeries(history: MetricRecord[], pick: (record: MetricRecord) => number) {
  if (history.length === 0) return "0,100";
  if (history.length === 1) {
    const y = 100 - Math.max(0, Math.min(100, pick(history[0])));
    return `0,${y} 100,${y}`;
  }
  return history
    .map((record, index) => {
      const x = history.length === 1 ? 100 : index / (history.length - 1) * 100;
      const y = 100 - Math.max(0, Math.min(100, pick(record)));
      return `${x},${y}`;
    })
    .join(" ");
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function MarkdownBlock({ content }: { content: string }) {
  const blocks = content.split(/```(\w+)?\n([\s\S]*?)```/g);
  const elements: ReactNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    if (index % 3 === 0) {
      const lines = blocks[index].split("\n");
      lines.forEach((line, lineIndex) => {
        const key = `${index}-${lineIndex}`;
        const trimmed = line.trim();
        if (!trimmed) {
          elements.push(<div className="md-gap" key={key} />);
        } else if (trimmed === "---") {
          elements.push(<hr key={key} />);
        } else if (trimmed.startsWith("> ")) {
          elements.push(<blockquote key={key}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
        } else if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
          elements.push(<h3 key={key}>{renderInlineMarkdown(trimmed.slice(2, -2))}</h3>);
        } else if (trimmed.startsWith("## ")) {
          elements.push(<h3 key={key}>{renderInlineMarkdown(trimmed.slice(3))}</h3>);
        } else if (trimmed.startsWith("# ")) {
          elements.push(<h3 key={key}>{renderInlineMarkdown(trimmed.slice(2))}</h3>);
        } else if (/^\d+\.\s+/.test(trimmed)) {
          elements.push(<p className="md-list" key={key}><span className="md-list-content">{renderInlineMarkdown(trimmed)}</span></p>);
        } else if (trimmed.startsWith("- ")) {
          elements.push(<p className="md-list" key={key}><span className="md-bullet">•</span><span className="md-list-content">{renderInlineMarkdown(trimmed.slice(2))}</span></p>);
        } else {
          elements.push(<p key={key}>{renderInlineMarkdown(trimmed)}</p>);
        }
      });
      continue;
    }

    if (index % 3 === 2) {
      elements.push(<pre className="md-code" key={index}>{blocks[index].trim()}</pre>);
    }
  }

  return <div className="markdown-answer">{elements}</div>;
}

export default function DashboardClient({ initialSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [question, setQuestion] = useState("为什么CPU占用高？");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [pressureRunning, setPressureRunning] = useState<Record<PressureTarget, boolean>>({
    cpu: false,
    memory: false,
    disk: false
  });
  const [pressurePending, setPressurePending] = useState<Record<PressureTarget, boolean>>({
    cpu: false,
    memory: false,
    disk: false
  });
  const [pressureMessage, setPressureMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const latest = snapshot.latest;
  const hasData = latest !== null;
  const memoryPercent = latest && latest.memory.totalKb > 0
    ? latest.memory.usedKb / latest.memory.totalKb * 100
    : 0;
  const diskPercent = latest && latest.disk.totalBytes > 0
    ? (latest.disk.totalBytes - latest.disk.availableBytes) / latest.disk.totalBytes * 100
    : 0;

  const chartSeries = useMemo(() => ({
    cpu: buildSeries(snapshot.history, (record) => record.cpu.usagePercent),
    memory: buildSeries(snapshot.history, (record) => record.memory.usedKb / record.memory.totalKb * 100),
    disk: buildSeries(snapshot.history, (record) => (record.disk.totalBytes - record.disk.availableBytes) / record.disk.totalBytes * 100)
  }), [snapshot.history]);

  const rawSnapshot = useMemo(() => JSON.stringify(snapshot.latest, null, 2), [snapshot.latest]);

  async function refresh() {
    const response = await fetch("/api/metrics", { cache: "no-store" });
    setSnapshot(await response.json());
  }

  useEffect(() => {
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);

  function askAi(nextQuestion = question) {
    startTransition(async () => {
      setError("");
      setAnswer("");
      setQuestion(nextQuestion);
      setIsDiagnosing(true);
      try {
        const response = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: nextQuestion })
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "AI诊断失败");
          return;
        }
        setAnswer(data.answer);
      } finally {
        setIsDiagnosing(false);
      }
    });
  }

  async function togglePressure(target: PressureTarget) {
    setPressurePending((current) => ({ ...current, [target]: true }));
    setPressureMessage("");
    try {
      const action = pressureRunning[target] ? "stop" : "start";
      const response = await fetch("/api/pressure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, action })
      });
      const data = await response.json();
      if (!response.ok) {
        setPressureMessage(data.error ?? "压力任务执行失败");
        return;
      }
      setPressureRunning((current) => ({ ...current, [target]: action === "start" }));
      setPressureMessage(data.result?.output?.trim() ?? (action === "start" ? "CPU压力已启动" : "CPU压力已停止"));
      window.setTimeout(refresh, 3500);
    } finally {
      setPressurePending((current) => ({ ...current, [target]: false }));
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <span className="eyebrow">OpsAI Assistant</span>
          <h1>Linux服务器智能运维助手</h1>
        </div>
        <button className="icon-button" onClick={refresh} title="刷新数据">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="status-line">
        <Activity size={18} />
        <span className={`status-pill ${hasData ? "live" : "waiting"}`}>{hasData ? "真实探针在线" : "等待真实探针"}</span>
        <span>{latest ? `${latest.hostname} · 最近上报 ${new Date(latest.receivedAt).toLocaleString()} · 已收 ${snapshot.history.length} 次采样` : "还没有收到 Linux 虚拟机的 probe 上报"}</span>
      </section>

      {!hasData ? (
        <section className="connection-panel">
          <div>
            <h2>等待 Linux 虚拟机真实数据</h2>
            <p>当前页面不会再填充演示数据。资源趋势、告警和 AI 诊断只基于虚拟机里的 `opsai-probe` 上报。</p>
          </div>
          <pre>{`# 在 Ubuntu 虚拟机中
sudo opsai-probe /etc/opsai/probe.conf

# /etc/opsai/probe.conf
server_url=http://<Mac宿主机IP>:3001/api/metrics
interval_seconds=3

# 制造真实高占用
cd probe/scripts
./run_pressure_scenario.sh cpu 90`}</pre>
        </section>
      ) : null}

      <section className="stats-grid">
        <StatCard
          icon={<Cpu size={24} />}
          label="CPU"
          value={latest ? percent(latest.cpu.usagePercent) : "未上报"}
          detail={latest ? "基于 /proc/stat 双采样计算" : "等待 probe 数据"}
          tone={(latest?.cpu.usagePercent ?? 0) > 85 ? "red" : "green"}
        />
        <StatCard
          icon={<Database size={24} />}
          label="内存"
          value={latest ? percent(memoryPercent) : "未上报"}
          detail={latest ? `${kbToGb(latest.memory.usedKb).toFixed(1)}GB / ${kbToGb(latest.memory.totalKb).toFixed(1)}GB` : "等待 /proc/meminfo"}
          tone={memoryPercent > 85 ? "red" : "blue"}
        />
        <StatCard
          icon={<HardDrive size={24} />}
          label="磁盘"
          value={latest ? percent(diskPercent) : "未上报"}
          detail={latest ? `${bytesToGb(latest.disk.availableBytes).toFixed(1)}GB 可用` : "等待 statvfs"}
          tone={diskPercent > 85 ? "red" : "amber"}
        />
        <StatCard
          icon={<Server size={24} />}
          label="系统负载"
          value={latest?.system ? latest.system.loadAverage.one.toFixed(2) : "未上报"}
          detail={latest?.system ? `5分钟 ${latest.system.loadAverage.five.toFixed(2)} · 15分钟 ${latest.system.loadAverage.fifteen.toFixed(2)}` : "等待 /proc/loadavg"}
          tone={(latest?.system?.loadAverage.one ?? 0) > 4 ? "red" : "blue"}
        />
        <StatCard
          icon={<Clock3 size={24} />}
          label="运行时间"
          value={formatUptime(latest?.system?.uptimeSeconds)}
          detail={latest?.system ? "来自 /proc/uptime" : "等待 /proc/uptime"}
          tone="green"
        />
        <StatCard
          icon={<ListTree size={24} />}
          label="进程样本"
          value={latest ? `${latest.processes?.length ?? 0} 个` : "未上报"}
          detail={latest ? "按常驻内存排序 TopN" : "等待 /proc/<pid>/status"}
          tone="amber"
        />
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-title">
            <h2>资源趋势</h2>
            <span>最近 {snapshot.history.length} 次采样</span>
          </div>
          <div className="chart-wrap">
            <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="资源趋势折线图">
              {hasData ? <polyline points={chartSeries.cpu} className="line cpu" /> : null}
              {hasData ? <polyline points={chartSeries.memory} className="line memory" /> : null}
              {hasData ? <polyline points={chartSeries.disk} className="line disk" /> : null}
            </svg>
            {!hasData ? <div className="chart-empty">等待 probe 连续上报后生成真实趋势</div> : null}
          </div>
          <div className="legend">
            <span><i className="dot cpu-dot" />CPU</span>
            <span><i className="dot memory-dot" />内存</span>
            <span><i className="dot disk-dot" />磁盘</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>告警线索</h2>
            <span>规则阈值 + 日志关键词</span>
          </div>
          <ul className="alerts">
            {snapshot.alerts.map((alert) => (
              <li key={alert}><AlertTriangle size={16} />{alert}</li>
            ))}
          </ul>
        </div>

        <div className="panel pressure-panel">
          <div className="panel-title">
            <h2>真实压力测试</h2>
            <span>通过 probe 在 VM 内执行</span>
          </div>
          <div className="pressure-actions">
            {pressureTargets.map((target) => {
              const pending = pressurePending[target.key];
              const running = pressureRunning[target.key];
              return (
                <button
                  key={target.key}
                  className={`pressure-button ${running ? "danger" : ""}`}
                  onClick={() => togglePressure(target.key)}
                  disabled={!hasData || pending}
                >
                  {pending ? <RefreshCw className="spin" size={17} /> : running ? <Square size={16} /> : <Flame size={17} />}
                  {pending ? "执行中" : running ? `停止${target.label}压力` : `启动${target.label}压力`}
                </button>
              );
            })}
          </div>
          <p className="pressure-copy">
            这些按钮不会写假数据，会让 Linux 虚拟机实际制造 CPU、内存或磁盘占用，probe 随后会上报真实资源变化。
          </p>
          {pressureMessage ? <pre className="pressure-output">{pressureMessage}</pre> : null}
        </div>

        <div className="panel log-panel">
          <div className="panel-title">
            <h2>日志摘要</h2>
            <span>Syslog / SSH</span>
          </div>
          <pre>{latest?.logs || "暂无日志摘要"}</pre>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>进程 TopN</h2>
            <span>按内存占用排序</span>
          </div>
          <div className="process-table">
            <div className="process-row header">
              <span>PID</span>
              <span>进程</span>
              <span>内存</span>
            </div>
            {(latest?.processes ?? []).map((process) => (
              <div className="process-row" key={`${process.pid}-${process.name}`}>
                <span>{process.pid}</span>
                <strong>{process.name}</strong>
                <span>{kbToGb(process.memoryKb).toFixed(2)} GB</span>
              </div>
            ))}
            {(latest?.processes?.length ?? 0) === 0 ? <p className="empty">暂无进程数据</p> : null}
          </div>
        </div>

        <div className="panel ai-panel">
          <div className="panel-title">
            <h2>AI故障诊断</h2>
            <span>Ollama gpt-oss:latest</span>
          </div>
          <div className="ask-row">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} />
            <button onClick={() => askAi()} disabled={!hasData || isPending || isDiagnosing}>
              {isPending || isDiagnosing ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
              {isPending || isDiagnosing ? "分析中" : "分析"}
            </button>
          </div>
          <div className="quick-actions">
            {quickQuestions.map((item) => (
              <button key={item} onClick={() => askAi(item)} disabled={!hasData || isPending || isDiagnosing}>
                {item}
              </button>
            ))}
          </div>
          {error ? <p className="error">{error}</p> : null}
          <article className="answer">
            {answer ? <MarkdownBlock content={answer} /> : <span><Bot size={18} />{hasData ? "基于当前真实 probe 快照调用本地 Ollama 诊断。" : "等待真实 probe 数据后才能进行 AI 诊断。"}</span>}
          </article>
        </div>

        <div className="panel raw-panel">
          <div className="panel-title">
            <h2>原始快照</h2>
            <span>AI 输入依据</span>
          </div>
          <pre>{latest ? rawSnapshot : "暂无真实上报数据"}</pre>
        </div>
      </section>
    </main>
  );
}
