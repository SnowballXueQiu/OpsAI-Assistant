#!/usr/bin/env bash
set -euo pipefail

ISO_PATH="${ISO_PATH:-$(pwd)/ubuntu-26.04-live-server-arm64.iso}"
DISK_PATH="${DISK_PATH:-$(pwd)/ubuntu-arm64.qcow2}"
MEMORY="${MEMORY:-4096}"
CPUS="${CPUS:-4}"

if [ ! -f "$DISK_PATH" ]; then
  qemu-img create -f qcow2 "$DISK_PATH" 40G
fi

qemu-system-aarch64 \
  -machine virt,accel=hvf,highmem=on \
  -cpu host \
  -smp "$CPUS" \
  -m "$MEMORY" \
  -drive if=pflash,format=raw,readonly=on,file="${QEMU_EFI_CODE:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}" \
  -drive file="$DISK_PATH",if=virtio,format=qcow2 \
  -cdrom "$ISO_PATH" \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::2222-:22 \
  -nographic

