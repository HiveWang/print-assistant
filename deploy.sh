#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，请先安装 Docker Engine 与 Compose 插件。"
  exit 1
fi

COMPOSE_ARGS=(-f docker-compose.yml)
if [[ -S /var/run/cups/cups.sock ]]; then
  COMPOSE_ARGS+=(-f docker-compose.cups-socket.yml)
  echo "已连接服务器本机 CUPS 打印队列。"
else
  echo "未发现本机 CUPS Socket，将连接 ${CUPS_SERVER:-host.docker.internal:631}。"
fi

docker compose "${COMPOSE_ARGS[@]}" up -d --build

PORT="${PRINT_ASSISTANT_PORT:-8080}"
echo
echo "打印助手已启动："
echo "  本机访问：http://localhost:${PORT}"
echo "  内网访问：http://<服务器IP>:${PORT}"
echo
echo "查看状态：docker compose ${COMPOSE_ARGS[*]} ps"
