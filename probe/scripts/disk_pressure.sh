#!/usr/bin/env bash
set -euo pipefail

SIZE_MB="${1:-512}"
DURATION="${2:-60}"
TARGET="${3:-/tmp/opsai-disk-pressure.bin}"

cleanup() {
  rm -f "$TARGET"
}
trap cleanup EXIT INT TERM

echo "Creating disk pressure file: ${TARGET}, size=${SIZE_MB}MB"
dd if=/dev/zero of="$TARGET" bs=1M count="$SIZE_MB" status=progress
sync
df -h /
echo "Holding file for ${DURATION}s, then cleaning up"
sleep "$DURATION"
echo "Disk pressure finished"

