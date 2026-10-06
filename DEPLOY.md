# 运输船 · 联机服务端部署指南（Windows 外网服务器）

架构：单个 Node 进程同时提供 **游戏网页（HTTP）+ 联机服务（WebSocket）**，全部游戏判定在权威服务端（30Hz 模拟、延迟补偿命中、反加速限制）。

## 一、最快上手（本机 / 内网）

**Windows**：安装 [Node.js LTS ≥ 18](https://nodejs.org/)，双击 `start-server.bat`。

**Linux / macOS / Git Bash**：安装 Node.js ≥ 18 后使用运维脚本（自动装依赖 + 构建 + 启动）：
```bash
bash deploy/start.sh              # 前台启动（Ctrl+C 停止）
bash deploy/start.sh -d           # 后台启动（日志 deploy/cf-ship.log，PID 见 deploy/cf-ship.pid）
bash deploy/start.sh --status     # 运行状态 + /healthz 健康检查 + 当前房间列表
bash deploy/start.sh --logs       # 跟踪日志
bash deploy/start.sh --stop       # 停止（按 PID 文件 + 端口反查双重兜底）
sudo bash deploy/start.sh --install    # 安装为 systemd 服务（开机自启、崩溃 3 秒自拉）
sudo bash deploy/start.sh --uninstall  # 卸载 systemd 服务
```
配置放在 `deploy/.env`（参考 `deploy/.env.example`）：`PORT / HOST / MAX_ROOMS / DEV_SRC`。
浏览器打开 `http://<服务器IP>:8080`，点主菜单「联 机 对 战」即可进房开战。

## 二、外网服务器部署

### 1. 放行端口
```powershell
netsh advfirewall firewall add rule name="cf-ship-8080" dir=in action=allow protocol=TCP localport=8080
```
云服务器（阿里云/腾讯云/AWS 等）还需在控制台「安全组」放行 TCP 8080 入站。

### 2. 上传代码
把整个项目目录拷到服务器（可不含 `node_modules`、`dist`，首次启动会自动生成）。Windows 双击 `start-server.bat`；Linux 运行 `bash deploy/start.sh -d`（详见上文「最快上手」）。

### 3. 后台常驻运行
- **推荐（Linux）**：`sudo bash deploy/start.sh --install`——安装为 systemd 服务（`cf-ship`），开机自启、崩溃 3 秒自拉；管理用 `systemctl status cf-ship` / `journalctl -u cf-ship -f`（日志同时写 `deploy/cf-ship.log`）。
- **简单**：`bash deploy/start.sh -d` 后台启动，`--stop` 停止。
- **Windows**：任务计划程序新建任务，操作填 `node.exe "D:\game\cf-transport-ship1\server\index.js"`，勾选"故障时重启"；或安装 [NSSM](https://nssm.cc/)：`nssm install CFShip "node" "server\index.js"`。
- **调试**：`pm2`（`npm i -g pm2; pm2 start server/index.js --name cfship`）。

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
- **人多时卡顿**：世界快照（所有角色坐标/状态）以**二进制**编码，服务端每 tick 只编码一次共享给全部连接（16 人约 308B/帧，比 JSON 省 ~57%）；每客户端另发一条含自身和解状态的小 JSON 控制帧。若仍吃紧可下调 `TICK_RATE`（需同步重建前端）。
- **断线后席位**：默认保留 30 秒（`RECONNECT_GRACE`），期间刷新页面/断网恢复都会自动回到原房间原位置。
- **修改代码后不生效**：改了 `src/` 需重新 `npm run build`（或删掉 `dist` 后重跑 bat）。
- **v2 协议**：快照拆分为「二进制世界帧 + JSON 控制帧」，按 tick 在客户端合并。旧页面（v1）连新服务端会提示版本不一致，Ctrl+F5 即可。

## 五、安全说明

- 昵称做长度与控制字符过滤；消息限流（每连接 120 条/秒、单条 ≤64KB）；每 IP 并发连接上限 `MAX_IP_CONNS`（默认 8）；服务端丢弃超预算输入（防加速）；重连票据为 80bit 随机串。
- **反作弊**：服务端对「开火瞬间准星瞬移」做检测——相邻命令视角跳变 >14° 且正在开火计一次，4 秒窗口内累计 6 次即判定可疑，**暂停其开火 4 秒**（仅清开火位，移动/视角不受影响，客户端无感知），并记 `aim_suspect` 日志。阈值保守，宁可漏报不误伤人类玩家。位置/速度类作弊因服务端权威重算物理天然无效。
- 服务无鉴权，属"知道地址即可玩"的小规模对战；如需封闭房间，可在反代层加访问控制或自行在 `handlers.join` 处扩展口令校验。
