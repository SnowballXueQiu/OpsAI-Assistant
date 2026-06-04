#!/usr/bin/env bash
set -euo pipefail

COUNT="${1:-8}"

echo "Writing synthetic log lines through logger, count=${COUNT}"
for i in $(seq 1 "$COUNT"); do
  logger -p auth.warning "sshd[$$]: Failed password for invalid user ops_test_${i} from 192.168.64.1 port $((51000 + i)) ssh2"
  logger -p daemon.err "opsai-test[$$]: simulated service error event index=${i}"
  sleep 1
done

echo "Synthetic log lines written. Check /var/log/auth.log, /var/log/syslog or journalctl depending on distro."

