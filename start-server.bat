@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================
echo  穿越火线 运输船 · 联机服务端 一键启动
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 v18 或更高版本：
  echo        https://nodejs.org/  （LTS 即可）
  echo        安装后重新双击本脚本。
  pause & exit /b 1
)

if not exist node_modules\ws (
  echo [1/3] 首次运行，正在安装依赖（需要联网）……
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [错误] 依赖安装失败，请检查网络。 & pause & exit /b 1 )
) else (
  echo [1/3] 依赖已就绪
)

if not exist dist\index.html (
  echo [2/3] 正在构建前端……
  call npm run build
) else (
  echo [2/3] 前端包已存在，跳过构建（如需更新请删除 dist 目录）
)

echo [3/3] 启动服务器……按 Ctrl+C 停止
echo       用浏览器访问本机地址或局域网地址即可加入
echo.
node server\index.js
echo.
echo 服务器已停止。
pause
