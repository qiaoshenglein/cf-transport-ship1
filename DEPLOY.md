# 运输船 · 联机服务端部署指南（Windows 外网服务器）

架构：单个 Node 进程同时提供 **游戏网页（HTTP）+ 联机服务（WebSocket）**，全部游戏判定在权威服务端（30Hz 模拟、延迟补偿命中、反加速限制）。

## 一、最快上手（本机 / 内网）

**Windows**：安装 [Node.js LTS ≥ 18](https://nodejs.org/)，双击 `start-server.bat`。

**Linux / macOS / Git Bash**：安装 Node.js ≥ 18 后：
```bash
chmod +x start-server.sh   # 仅需一次
./start-server.sh          # 默认 8080；自定义：PORT=9000 ./start-server.sh
# 后台常驻：nohup ./start-server.sh > ship.log 2>&1 &
```

两者都会自动完成：装依赖 → 构建前端 → 启动服务。
浏览器打开控制台打印的地址（默认 `http://localhost:8080`），点主菜单「联 机 对 战」即可进房开战；把局域网/公网地址发给朋友即可多人游玩。

## 二、外网服务器部署

### 1. 放行端口
```powershell
netsh advfirewall firewall add rule name="cf-ship-8080" dir=in action=allow protocol=TCP localport=8080
```
云服务器（阿里云/腾讯云/AWS 等）还需在控制台「安全组」放行 TCP 8080 入站。

### 2. 上传代码
把整个项目目录拷到服务器（可不含 `node_modules`、`dist`，首次启动会自动生成）。Windows 双击 `start-server.bat`；Linux 运行 `./start-server.sh`（可配合 `nohup` 或下方 systemd/NSSM 守护）。

### 3. 后台常驻运行（三选一）
- **简单**：任务计划程序（Task Scheduler）新建任务，操作填 `node.exe "D:\game\cf-transport-ship1\server\index.js"`，勾选"故障时重启"。
- **可靠**：安装 [NSSM](https://nssm.cc/)，`nssm install CFShip "node" "server\index.js"`，服务自动随系统启动并守护进程。
- **调试**：直接开一个 PowerShell 窗口运行，或用 `pm2`（`npm i -g pm2; pm2 start server/index.js --name cfship`）。

### 4. 环境变量（可选）
| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket 端口（`PORT=0` 随机端口，测试用） |
| `HOST` | `0.0.0.0` | 监听地址，公网机器保持默认 |
| `MAX_ROOMS` | `32` | 同时存在的房间上限 |
| `DEV_SRC` | 空 | 设为 `1` 时以 ES 模块直接提供 `/src` 源码（调试/自动化测试用，生产不要开） |

PowerShell 示例：`$env:PORT=80; node server\index.js`

### 5. HTTPS（域名 + 加密 wss，推荐）
页面本身是单文件 HTML，可用任意反代终结 TLS 后转发到 `127.0.0.1:8080`，客户端会自动使用 `wss://`。
nginx 配置片段：
```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;      # WebSocket 必须
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```
用 Caddy/IIS 反向代理同理：转发 `/ws` 时保留 Upgrade 头。

## 三、验证与测试

```bat
npm test                     :: 服务端冒烟：房间/移动/射击命中/复活/断线回收 + 网关端到端（约 15s）
node test\browser-net.mjs    :: 真实 Chrome 联机回归：大厅/预测和解/插值/自动重连（约 25s，需本机装有 Chrome）
```
健康检查：`http://你的IP:8080/healthz`（返回 ok）、`/api/rooms`（房间列表 JSON）。

## 四、常见问题

- **进房提示「客户端版本与服务端不一致」**：浏览器缓存了旧页面，Ctrl+F5 强刷；服务端协议版本见 `src/protocol.js` 的 `PROTO_VERSION`。
- **能连上但人物不动**：确认没有中间层截断 WebSocket（见上文 Upgrade 头）。
- **人多时卡顿**：快照为每客户端每 tick 一条 JSON，30Hz；若 CPU 吃紧可下调 `TICK_RATE`（需同步重建前端）。
- **断线后席位**：默认保留 30 秒（`RECONNECT_GRACE`），期间刷新页面/断网恢复都会自动回到原房间原位置。
- **修改代码后不生效**：改了 `src/` 需重新 `npm run build`（或删掉 `dist` 后重跑 bat）。

## 五、安全说明

- 昵称做长度与控制字符过滤；消息限流（每连接 120 条/秒、单条 ≤64KB）；服务端丢弃超预算输入（防加速）；重连票据为 80bit 随机串。
- 服务无鉴权，属"知道地址即可玩"的小规模对战；如需封闭房间，可在反代层加访问控制或自行在 `handlers.join` 处扩展口令校验。
