#!/usr/bin/env bash
set -euo pipefail

METRICS_URL="${METRICS_URL:-http://127.0.0.1:3001/api/metrics}"
MODEL="${OLLAMA_MODEL:-gpt-oss:latest}"
QUESTION="${1:-为什么CPU占用高？请结合当前Linux监控数据和日志给出诊断。}"

snapshot="$(curl -fsS "$METRICS_URL")"

prompt="你是Linux服务器智能运维助手。请根据下面的真实Dashboard快照进行诊断。
要求：
1. 判断当前现象；
2. 给出建议执行的Linux命令；
3. 说明可能原因；
4. 给出处置建议；
5. 不要编造快照中没有的数据。

用户问题：
$QUESTION

Dashboard快照：
$snapshot"

ollama run "$MODEL" "$prompt"

