#!/usr/bin/env bash
# 穿越火线 运输船 · 联机服务端 一键启动（Linux / macOS / Git Bash）
# 用法：./start-server.sh            —— 默认端口 8080
#       PORT=9000 ./start-server.sh  —— 自定义端口
#       HOST=127.0.0.1 ./start-server.sh  —— 仅本机监听
set -u
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo " 穿越火线 运输船 · 联机服务端 一键启动"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 v18 或更高版本："
  echo "       Debian/Ubuntu : sudo apt install -y nodejs npm   （或使用 NodeSource LTS）"
  echo "       CentOS/RHEL   : sudo dnf install -y nodejs"
  echo "       官网          : https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[错误] Node.js 版本过低（需要 >= 18，当前 $(node -v)）"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/three ]; then
  echo "[1/3] 首次运行，正在安装依赖（需要联网）……"
  npm install --no-audit --no-fund || { echo "[错误] 依赖安装失败，请检查网络"; exit 1; }
else
  echo "[1/3] 依赖已就绪"
fi

if [ ! -f dist/index.html ]; then
  echo "[2/3] 正在构建前端……"
  npm run build || { echo "[错误] 构建失败"; exit 1; }
else
  echo "[2/3] 前端包已存在，跳过构建（如需更新请删除 dist 目录后重跑）"
fi

echo "[3/3] 启动服务器……按 Ctrl+C 停止"
echo "      浏览器访问 http://<服务器IP>:${PORT:-8080} ，主菜单点「联 机 对 战」"
echo
# exec 让 node 直接接管信号（SIGINT/SIGTERM），便于 systemd / nohup 守护
exec node server/index.js
