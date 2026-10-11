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
把整个项目目录拷到服务器（可不含 `node_modules`、`dist`，首次启动会自动生成）。**`assets/models/*.glb` 不在自动生成之列，必须一起上传**——漏了不会报错，只是 BOSS 仍旧用程序化外观（启动脚本会提示）。Windows 双击 `start-server.bat`；Linux 运行 `bash deploy/start.sh -d`（详见上文「最快上手」）。

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
| `ADMIN_TOKEN` | 空 | 运维后台口令。**不设 = 后台完全无验证**（见第六节），建议公网机器必设 |
| `MAX_IP_CONNS` | `8` | 单 IP 并发 WebSocket 连接上限 |

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
node test\console.mjs        :: 运维后台回归：快照/SSE/六类动作/踢人后旧票据失效/ADMIN_TOKEN 鉴权分支（约 5s）
node test\mapprobe.mjs all   :: 六张地图可达性与两边公平体检（约 2s，无浏览器依赖）
node test\assetlab.mjs       :: 建模资产工作台回归：清单/提示词/GLB 实时预览/自动验收三态/本地库持久化（约 9s，需 Chrome）
```
健康检查：`http://你的IP:8080/healthz`（返回 ok）、`/api/rooms`（房间列表 JSON）、`/admin`（实时运维控制台，见第六节）。

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

## 六、实时运维控制台 `/admin`

浏览器打开 `http://你的IP:8080/admin` 即可，**无需构建、无需额外进程**（页面是同目录的 `server/admin.html`，数据走同一个 HTTP 端口）。

### 看什么
| 区块 | 内容 |
|---|---|
| 顶部指标卡 | 在线真人 / WebSocket 连接 / 房间数与上限 / 机器人 / 存活怪物 / 消息每秒 / 进程 CPU / 常驻内存 / 堆用量 / **事件循环延迟**与峰值 / 重连票据，每张带最近 2 分钟折线 |
| 房间表 | 地图、模式、状态（进行中 / 结算中 / **运维暂停**）、人数与掉线留席数、机器人、观战、怪物与 BOSS、波次、剩余时间、比分、**tick 达成率**（权威 30Hz，低于 25 标红）、运行时长 |
| 名册（点房间行展开） | 每人：阵营、身份（房主 / 机器人 / BOSS 附身 / 掉线留席）、ping、生命护甲、K/D/爆头/命中率、当前武器。表头可按 ping、K、命中率排序，真人自动排在前 |
| 事件流水 | 服务端日志的环形缓冲（最近 400 条）：建房/加入/断线/重连、疑似作弊、限流断开，以及**每一条运维动作**。可按级别（info / warn / ops）与关键字过滤 |

指标口径提示：**事件循环延迟涨而 CPU 不满**，一般是某个 tick 里同步建图或批量寻路；`tick 达成率`掉到 30 以下说明服务端已经开始丢帧，先看房数与人数，再看延迟峰值。

### 六种干预动作
- **暂停 / 恢复**：置 `paused` 并停掉该房的 30Hz 定时器。场内玩家画面静止、倒计时冻结，但连接与席位保留；大厅列表上该房显示「运维暂停」。恢复即继续，不重开。
- **重开一轮**：比分、时限、波次进度归零并广播 `start`；若该房处于暂停会顺带恢复。
- **公告**：向该房所有真人播一条 80 字内提示（走既有事件通道，不改协议）。
- **清机器人**：清掉该房全部或指定阵营的机器人。
- **踢出**：清席位 + **作废该玩家的重连票据** + 给他的连接单发一条 `kicked`，客户端清票回大厅并刷新房单。连接本身不断开，所以是"请出去"而不是"断网"；旧票据也捞不回席位（回归里有专门一条断言）。
- **关房**：把房内真人和观战全部请回大厅并注销房间，不可撤销。

战斗数值与容量参数**故意没有热调入口**：改 `MAX_ROOMS` / `PORT` / 波次与血量配置一律走环境变量 + 重启，避免后台变成随手改平衡的地方。

### 访问控制（重要）
默认 `ADMIN_TOKEN` 不设 = **后台完全无验证**：任何能访问到该端口的人都能踢人、停房、关房，也能看到所有房间与连接情况。三种收口方式，按需要选一种：

1. **只在内网/本机开**：`HOST=127.0.0.1`（游戏页面若也在本机就一起受影响）或安全组只放行运维网段访问端口。
2. **设口令**（推荐，代码已内置）：
   ```bat
   :: Windows PowerShell
   $env:ADMIN_TOKEN="换成你自己的长随机串"; node server\index.js
   ```
   ```sh
   # Linux / start.sh
   ADMIN_TOKEN='换成你自己的长随机串' ./deploy/start.sh start
   ```
   设了口令后：未登录访问 `/api/console/*` 一律 **404**（连"这里有个后台"都不透露），打开 `/admin` 会弹口令框；成功后发 12 小时 `HttpOnly + SameSite=Strict` cookie。命令行脚本化调用可以直接带头：`-H "x-admin-token: 口令"`。
3. **反代再加一层**：只给 `/admin`、`/api/console/` 开 basic auth + IP 白名单。走 nginx 时注意 SSE 别被攒住——服务端已回 `x-accel-buffering: no`，若你的反代不认这个头，给该 location 补一句 `proxy_buffering off;`（页面自身检测不到推送时会自动退回 2 秒轮询，不会瞎掉）。

后台窗口最多同时开 8 个，超出会提示先关掉一个（防止开着几十个标签页把连接数占满）。

## 七、建模资产工作台 `/tools/assetlab.html`（改造外部模型时用）

游戏里的角色、怪物、枪械目前全是代码拼出来的。要换成 Tripo 生成的模型，就先用这个工作台把"要建什么、怎么建、算不算合格"固定下来。

**打开方式**（只在本机开发时用，玩家访问不到）：

```bat
:: Windows PowerShell
$env:DEV_SRC="1"; node server\index.js
:: 然后浏览器开 http://localhost:8080/tools/assetlab.html
```

`DEV_SRC=1` 是让服务端直接以源码方式提供 `/tools`、`/src`、`/vendor`；生产环境不要开（不开时这个页面 403，玩家拿不到源码）。

**页面分三栏**：左边是按优先级排好的 15 个待建条目（可按优先级/类别/状态筛，可搜索提示词关键词）；中间是单条目的规格、给 Tripo 的提示词（点「复制」直接粘）、需要的动作片段、人工验收清单；右边是 3D 实时预览——把导出的 `.glb` 拖到窗口任意位置即可，旁边立一个 1.8 m 参照人形，脚下有网格。

**自动核对项**（载入 GLB 后立刻出结果，绿=合格 / 黄=可接受但要确认 / 红=退回）：真实米制总高度、骨骼是否齐（`mixamorig:LeftUpLeg`、`Idle_001` 这类命名按关键词自动放行）、动作片段是否齐、武器锚点节点、贴图尺寸上限。**三角面数只作参考、不卡门槛**——清单里的区间是"同屏 20+ 只小怪"这类场景给的量级感，超了照样收；性能要在引擎里按同屏总三角面与实测帧率判，单模型预算拦不住真正的问题。

两条"能救就别退回"的规则：

- **高度不达标会自动等比例缩放**（容差内不动它，保留真实测量值）。黄色那行会写清「原始 1.7m → ×1.882 → 3.2m」，缩放系数与原始尺寸一并进验收单——差 10 倍以上才判红，那通常是导出单位或场景缩放坏了。
- **动作名可以手工指认**：条目下方「动作名映射」给每个语义动作（idle / run / attack / skill / death / hurt…）一个下拉，把 `Take 001` 这类不可读的名字对上号即可，映射存本地库、随验收单导出，标 `*` 表示这条是手工指定的。

**优先级**：P0 三只 BOSS（铁皮暴君 / 瘟疫母体 / 幽影猎手）→ P1 三种小怪 + 人类士兵底模 → P2 六把枪 → P3 军刀与补给箱。

**数据留在哪**：状态、验收意见、以及 GLB 二进制全部存在这台机器的浏览器 IndexedDB 里，不上传服务器。换机器时点右上角「导出验收单 JSON」把结论带走（含实测尺寸/面数/骨骼/clip 名与退回理由），GLB 本体需要在新机器上重新拖一次。

**回归**：`node test\assetlab.mjs` 会在真 Chrome 里造三个合法 GLB（有骨骼有动画 / clip 名不可读 / 无骨骼无动画）跑一遍完整流程，约 9 秒。

## 八、外部模型接入（P0：三只 BOSS 已完成）

`assets/models/boss_tyran.glb` / `boss_mother.glb` / `boss_shade.glb` 由服务端 `/assets/*` 直供（`model/gltf-binary`，带 ETag 复验，客户端 304 命中就不重传 3.5MB）。接入层是 `src/bossmodels.js`，被 `src/bosslook.js` 的 `dressSoldier` 在最后一步调用。

必须知道的四条约定：

- **视觉高 == 命中盒高**：GLB 挂上时按 `程序化人体净高 × SIZE[kind].h` 等比缩放，和 `server/room.js` 的 `hitScaleOf` 同源。这条由 `test/boss-glb.mjs` 量出来（实测 3.48 / 3.93 / 3.18 m），不是靠读代码相信的。命中盒本身**不读模型文件**，它只吃 `poseOf(a)` 的 7 个量 + 19 骨 FK，所以换模型不改任何判定。
- **朝向**：Tripo 的模型脚尖朝 +Z，本项目约定实体面朝 -Z，所以 attach 时统一 `rotation.y = π`。回归里有"踝-趾 z 差 > 0.02m"的断言，换模型如果倒着跑会立刻红。
- **动画**：clip 名按关键词映射（`run`/`idle`/`攻击`→attack/`fall`→death/`box_01`→skill），语义表在 `bossmodels.js` 的 `CLIP_WORDS`；各 clip 的骨盆 x/z 偏移以 idle 为基准归零，否则 idle↔run 切换时整具身体会横移 0.47 单位（缩放后 2 米）。位置与朝向仍由服务端权威驱动，模型动画**不许带根位移**。
- **兜底**：拿不到 GLB（离线 `file://` 双击打开、或文件缺失）时 `attachBossModel` 返回 false，`dressSoldier` 保留原来的程序化外观，游戏照常跑。
- **进场前加载完**：模型在启动加载屏里一次性下完（`载入 BOSS 模型 2/3 · 7.2 / 10.4 MB`，按真实字节推进，进度只增不减），下载完立刻 `renderer.compile` 预编译。所以 BOSS 登场那一刻要么已经是完整模型，要么本来就是程序化外观，不会出现"半只怪"。

换模型只要把新文件覆盖成上面三个名字即可，不需要改代码也不需要重新 `npm run build`（模型是运行时 fetch，不在 dist 里）。
