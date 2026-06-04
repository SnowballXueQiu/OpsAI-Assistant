export type ProbePayload = {
  hostname: string;
  sentAt: string | number;
  system?: {
    uptimeSeconds: number;
    loadAverage: {
      one: number;
      five: number;
      fifteen: number;
    };
  };
  cpu: { usagePercent: number };
  memory: { totalKb: number; usedKb: number; availableKb: number };
  disk: { mount: string; totalBytes: number; availableBytes: number };
  processes?: Array<{
    pid: number;
    name: string;
    memoryKb: number;
  }>;
  logs: string;
};

export type MetricRecord = ProbePayload & {
  receivedAt: string;
};

export type DashboardSnapshot = {
  latest: MetricRecord | null;
  history: MetricRecord[];
  alerts: string[];
};

export type CommandResult = {
  id: string;
  hostname: string;
  label: string;
  command: string;
  output: string;
  exitCode: number;
  createdAt: string;
  completedAt?: string;
};
