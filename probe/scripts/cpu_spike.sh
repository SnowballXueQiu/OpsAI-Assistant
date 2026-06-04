#!/usr/bin/env bash
set -euo pipefail

DURATION="${1:-60}"
WORKERS="${2:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "Starting CPU pressure: duration=${DURATION}s workers=${WORKERS}"
for _ in $(seq 1 "$WORKERS"); do
  yes > /dev/null &
  PIDS+=("$!")
done

sleep "$DURATION"
echo "CPU pressure finished"

