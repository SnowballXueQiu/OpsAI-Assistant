import type { DashboardSnapshot, MetricRecord, ProbePayload } from "./types";

const globalStore = globalThis as unknown as {
  __opsaiMetrics?: MetricRecord[];
};

function records() {
  if (!globalStore.__opsaiMetrics) globalStore.__opsaiMetrics = [];
  return globalStore.__opsaiMetrics;
}

export function addMetric(payload: ProbePayload) {
  const record: MetricRecord = {
    ...payload,
    receivedAt: new Date().toISOString()
  };
  const data = records();
  data.push(record);
  if (data.length > 120) data.splice(0, data.length - 120);
  return record;
}

export function clearMetrics() {
  records().splice(0);
}

export function getSnapshot(): DashboardSnapshot {
  const history = records();
  const latest = history.at(-1) ?? null;
  return {
    latest,
    history: history.slice(-30),
    alerts: latest ? buildAlerts(latest) : ["等待 probe 上报数据"]
  };
}

function buildAlerts(record: MetricRecord) {
  const alerts: string[] = [];
  if (record.cpu.usagePercent >= 85) alerts.push("CPU 使用率超过 85%，建议检查高负载进程");
  if ((record.system?.loadAverage.one ?? 0) >= 4) alerts.push("1 分钟系统负载偏高，建议结合 CPU 核数和进程 TopN 判断");
  const memoryPercent = record.memory.totalKb > 0 ? record.memory.usedKb / record.memory.totalKb * 100 : 0;
  if (memoryPercent >= 85) alerts.push("内存使用率超过 85%，建议检查缓存、泄漏和常驻服务");
  const topProcess = record.processes?.[0];
  if (topProcess && topProcess.memoryKb > record.memory.totalKb * 0.25) {
    alerts.push(`${topProcess.name} 进程内存占比偏高，建议检查 PID ${topProcess.pid}`);
  }
  const diskPercent = record.disk.totalBytes > 0
    ? (record.disk.totalBytes - record.disk.availableBytes) / record.disk.totalBytes * 100
    : 0;
  if (diskPercent >= 85) alerts.push("根分区磁盘使用率超过 85%，建议清理日志或扩容");
  if (/failed|error|invalid user|authentication failure/i.test(record.logs)) {
    alerts.push("日志中出现失败、错误或 SSH 异常登录线索");
  }
  if (alerts.length === 0) alerts.push("当前没有触发高风险阈值");
  return alerts;
}
