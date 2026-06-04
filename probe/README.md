# OpsAI Probe

`opsai-probe` is a small Linux system probe written in C++. It collects CPU,
memory, disk and basic log signals from a Linux server, then posts the data to
the Next.js application.

## Build on Ubuntu

```bash
sudo apt update
sudo apt install -y build-essential cmake
cmake -S . -B build
cmake --build build
sudo cmake --install build
```

## Run

```bash
sudo opsai-probe /etc/opsai/probe.conf
```

## Pressure Test Scripts

These scripts are intended to run inside the Ubuntu VM while `opsai-probe` is
running. They create temporary load so the dashboard and AI diagnosis can be
tested with visible signals.

```bash
# CPU high usage for 90 seconds
probe/scripts/run_pressure_scenario.sh cpu 90

# Memory pressure, default 768MB for 90 seconds
probe/scripts/run_pressure_scenario.sh memory 768 90

# Temporary disk pressure file under /tmp, cleaned automatically
probe/scripts/run_pressure_scenario.sh disk 1024 90

# Synthetic SSH/service error logs through logger
probe/scripts/run_pressure_scenario.sh logs 12

# CPU + memory + log fault scenario
probe/scripts/run_pressure_scenario.sh mixed
```

AI 诊断测试请在宿主机 Web 目录运行 `web/scripts/ollama-cli-diagnose.sh`。该脚本读取当前 Dashboard 快照，不伪造指标。

Default config:

```ini
server_url=http://127.0.0.1:3000/api/metrics
interval_seconds=5
hostname=
log_files=/var/log/syslog,/var/log/auth.log
```

If `hostname` is empty, the probe uses the OS hostname.

## Debian Package Skeleton

The `debian/` folder is intentionally lightweight for a course project. On
Ubuntu, install `debhelper` and run:

```bash
sudo apt install -y debhelper
dpkg-buildpackage -us -uc
```
