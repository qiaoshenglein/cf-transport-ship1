#!/usr/bin/env bash
# 穿越火线 运输船 · 联机服务端 一键启动脚本（Linux / macOS / Git Bash）
#   bash deploy/start.sh              前台启动（Ctrl+C 停止）
#   bash deploy/start.sh -d           后台启动（日志 deploy/cf-ship.log，PID 见 .pid）
#   bash deploy/start.sh --stop       停止后台实例
#   bash deploy/start.sh --status     查看运行状态（含健康检查与房间数）
#   bash deploy/start.sh --logs       跟踪日志
#   bash deploy/start.sh --install    安装为 systemd 服务（开机自启、崩溃自拉）
#   bash deploy/start.sh --uninstall  卸载 systemd 服务
#   配置：复制 deploy/.env.example 为 deploy/.env 可覆盖 PORT/HOST/MAX_ROOMS 等
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
CONF="$DIR/deploy/.env"
LOG="$DIR/deploy/cf-ship.log"
PIDF="$DIR/deploy/cf-ship.pid"
NAME=cf-ship

# ---- 读取配置（deploy/.env 可覆盖）
if [ -f "$CONF" ]; then set -a; . "$CONF"; set +a; fi
export PORT="${PORT:-8080}" HOST="${HOST:-0.0.0.0}"
[ -n "${MAX_ROOMS:-}" ] && export MAX_ROOMS
[ -n "${MAX_IP_CONNS:-}" ] && export MAX_IP_CONNS
[ -n "${DEV_SRC:-}" ] && export DEV_SRC

# ---- 确保 node 存在（服务端依赖 node:http + ws，需 Node >= 18）
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js（需要 v18 或更高），请先安装："
  echo "  Debian/Ubuntu : sudo apt install -y nodejs npm   （或 NodeSource: https://nodejs.org）"
  echo "  CentOS/RHEL   : sudo dnf module install nodejs:18  或 curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -"
  echo "  macOS         : brew install node"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node.js 版本过低（需 >= 18，当前 $(node -v)）"; exit 1; }

# ---- 依赖与前端包（首次自动准备）
if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/three ]; then
  echo "正在安装依赖（需要联网）……"
  command -v npm >/dev/null 2>&1 || { echo "未找到 npm，请随 Node.js 一起安装"; exit 1; }
  npm install --no-audit --no-fund
fi
if [ ! -f dist/index.html ]; then
  echo "正在构建前端……"
  npm run build
fi

port_pid() {
  if command -v ss >/dev/null 2>&1; then ss -lptn "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  elif command -v lsof >/dev/null 2>&1; then lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
  elif command -v netstat >/dev/null 2>&1; then netstat -ano 2>/dev/null | grep -E "[:.]$PORT[[:space:]]" | grep -i LISTEN | awk '{print $NF}' | head -1
  fi
}

stop_pid() { # 兼容 Git Bash（Windows 进程需用 taskkill 才能真正终止）
  if command -v taskkill >/dev/null 2>&1 && uname -o 2>/dev/null | grep -qi msys; then
    taskkill //PID "$1" //T //F >/dev/null 2>&1 || true
  else
    kill "$1" 2>/dev/null || true
  fi
}

case "${1:-run}" in
  -d|--daemon)
    OLD="$(port_pid || true)"
    [ -z "$OLD" ] || { echo "端口 $PORT 已被进程 $OLD 占用，先执行 bash deploy/start.sh --stop"; exit 1; }
    nohup node server/index.js >>"$LOG" 2>&1 &
    echo $! >"$PIDF"
    sleep 1.5
    if kill -0 "$(cat "$PIDF")" 2>/dev/null; then
      echo "已在后台启动 · PID $(cat "$PIDF") · 端口 $PORT"
      echo "玩家入口  http://<公网IP>:$PORT/    联机端点  ws://<公网IP>:$PORT/ws"
      echo "健康检查  curl http://127.0.0.1:$PORT/healthz     日志  bash deploy/start.sh --logs"
      echo "提示：若防火墙/安全组未放行 $PORT，请自行开放（云主机需在安全组添加入方向 TCP）。"
    else
      echo "启动失败，最近日志："; tail -20 "$LOG" 2>/dev/null || true; exit 1
    fi
    ;;
  --stop)
    had=0
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then stop_pid "$(cat "$PIDF")"; had=1; fi
    rm -f "$PIDF"
    sleep 0.6
    # 兜底：按端口反查（Git Bash 的 MSYS PID 与系统 PID 可能不一致，或实例非本脚本启动）
    P="$(port_pid || true)"
    [ -n "$P" ] && { stop_pid "$P"; sleep 0.6; }
    P2="$(port_pid || true)"
    if [ -z "$P2" ]; then
      if [ "$had" = 1 ] || [ -n "$P" ]; then echo "已停止"; else echo "没有在运行的实例"; fi
    else
      echo "停止失败：端口 $PORT 仍被进程 $P2 占用"; exit 1
    fi
    ;;
  --status)
    P="$(port_pid || true)"
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "运行中 · PID $(cat "$PIDF") · 端口 $PORT"
    elif [ -n "$P" ]; then echo "运行中（非本脚本启动）· PID $P · 端口 $PORT"
    else echo "未运行"; fi
    if command -v curl >/dev/null 2>&1; then
      H="$(curl -s --max-time 3 "http://127.0.0.1:$PORT/healthz" || true)"
      echo "健康检查: ${H:-无响应}"
      [ -n "$H" ] && echo "当前房间: $(curl -s --max-time 3 "http://127.0.0.1:$PORT/api/rooms" || true)"
    fi
    ;;
  --logs)
    [ -f "$LOG" ] || { echo "尚无日志文件"; exit 0; }
    tail -n 60 -f "$LOG"
    ;;
  --install)
    [ "$(id -u)" = 0 ] || { echo "安装 systemd 服务需要 root：sudo bash deploy/start.sh --install"; exit 1; }
    command -v systemctl >/dev/null || { echo "此系统没有 systemd，请改用 --daemon 或 Docker"; exit 1; }
    RUN_USER="${SUDO_USER:-$(whoami)}"
    NODE_PATH="$(command -v node)"
    sed -e "s|__DIR__|$DIR|g" -e "s|__USER__|$RUN_USER|g" -e "s|__NODE__|$NODE_PATH|g" -e "s|__PORT__|$PORT|g" "$DIR/deploy/$NAME.service" >"/etc/systemd/system/$NAME.service"
    systemctl daemon-reload
    systemctl enable --now "$NAME"
    sleep 1
    systemctl --no-pager --lines=8 "status $NAME" || true
    echo "服务已安装：systemctl {status|restart|stop} $NAME ；日志 journalctl -u $NAME -f"
    ;;
  --uninstall)
    [ "$(id -u)" = 0 ] || { echo "需要 root：sudo bash deploy/start.sh --uninstall"; exit 1; }
    systemctl disable --now "$NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/$NAME.service"
    systemctl daemon-reload
    echo "已卸载 systemd 服务"
    ;;
  run|"")
    echo "前台启动（Ctrl+C 停止）· 端口 $PORT · 后台运行请用 bash deploy/start.sh -d"
    exec node server/index.js
    ;;
  *)
    echo "用法：bash deploy/start.sh [-d|--stop|--status|--logs|--install|--uninstall]"
    exit 1
    ;;
esac
