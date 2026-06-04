# Linux VM Pressure Scripts

这些脚本必须在 Ubuntu/Linux 虚拟机里运行，用来制造真实 CPU、内存、磁盘和日志压力。正确链路是：

```text
Linux压力脚本 -> Linux内核指标变化 -> opsai-probe采集 -> Next.js /api/metrics -> Dashboard趋势图 -> AI诊断
```

## 1. 先运行 probe

在虚拟机中确认 `probe.conf` 指向宿主机 Web 地址。页面现在如果是 `http://localhost:3001`，虚拟机里通常不能写 `127.0.0.1`，要写宿主机可访问 IP，例如：

```ini
server_url=http://<Mac宿主机IP>:3001/api/metrics
interval_seconds=3
```

然后运行：

```bash
sudo opsai-probe /etc/opsai/probe.conf
```

## 2. 制造真实负载

```bash
# CPU 高占用，持续 90 秒，worker 数默认等于 CPU 核数
./run_pressure_scenario.sh cpu 90

# 内存压力，占用约 768MB，持续 90 秒
./run_pressure_scenario.sh memory 768 90

# 磁盘压力，在 /tmp 写入 1024MB 临时文件，90 秒后自动删除
./run_pressure_scenario.sh disk 1024 90

# 写入 SSH 失败登录和服务错误日志
./run_pressure_scenario.sh logs 12

# CPU + 内存 + 日志混合场景
./run_pressure_scenario.sh mixed 768
```

## 3. AI CLI 测试

在宿主机 Web 目录运行：

```bash
cd web
METRICS_URL=http://127.0.0.1:3001/api/metrics ./scripts/ollama-cli-diagnose.sh "为什么CPU占用高？"
```

该脚本不会伪造指标，只读取当前 Web 平台收到的真实 probe 快照，然后调用本地 `ollama run gpt-oss:latest`。

