#!/usr/bin/env python3
import os
import sys
import time

mb = int(sys.argv[1]) if len(sys.argv) > 1 else 512
duration = int(sys.argv[2]) if len(sys.argv) > 2 else 60
chunk_mb = 16
chunks = []

print(f"Starting memory pressure: {mb}MB for {duration}s, pid={os.getpid()}", flush=True)
for _ in range(max(1, mb // chunk_mb)):
    chunks.append(bytearray(chunk_mb * 1024 * 1024))
    time.sleep(0.05)

time.sleep(duration)
print("Memory pressure finished", flush=True)

