#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3001}"

echo "Candidate probe targets for the Ubuntu VM:"
printed=0
if command -v ipconfig >/dev/null 2>&1; then
  default_iface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
  candidates="en0 en1 bridge100"
  if [ -n "$default_iface" ]; then
    candidates="$default_iface $candidates"
  fi
  for iface in $candidates; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [ -n "$ip" ]; then
      echo "  http://${ip}:${PORT}/api/metrics    # ${iface}"
      printed=1
    fi
  done
fi

if [ "$printed" = "0" ]; then
  echo "  No macOS interface IP was detected automatically."
  echo "  Run this on the Mac host and use the address reachable from the VM:"
  echo "    ifconfig | grep 'inet '"
fi

echo
echo "Put one reachable URL into /etc/opsai/probe.conf inside the VM:"
cat <<EOF
server_url=http://<Mac宿主机IP>:${PORT}/api/metrics
interval_seconds=3
hostname=
log_files=/var/log/syslog,/var/log/auth.log
EOF

echo
echo "Then run inside Ubuntu:"
cat <<'EOF'
sudo opsai-probe /etc/opsai/probe.conf
EOF
