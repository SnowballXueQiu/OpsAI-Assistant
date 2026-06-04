#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${1:-cpu}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$SCENARIO" in
  cpu)
    "$ROOT_DIR/cpu_spike.sh" "${2:-90}" "${3:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}"
    ;;
  memory)
    python3 "$ROOT_DIR/memory_pressure.py" "${2:-768}" "${3:-90}"
    ;;
  disk)
    "$ROOT_DIR/disk_pressure.sh" "${2:-1024}" "${3:-90}"
    ;;
  logs)
    "$ROOT_DIR/log_faults.sh" "${2:-12}"
    ;;
  mixed)
    "$ROOT_DIR/log_faults.sh" 8 &
    logs_pid=$!
    "$ROOT_DIR/cpu_spike.sh" 90 &
    cpu_pid=$!
    python3 "$ROOT_DIR/memory_pressure.py" "${2:-768}" 90 &
    mem_pid=$!
    wait "$logs_pid" || true
    wait "$cpu_pid" || true
    wait "$mem_pid" || true
    ;;
  *)
    echo "Usage: $0 {cpu|memory|disk|logs|mixed}"
    exit 2
    ;;
esac

