# 潜伏者 / 保卫者第三人称模型

2026-10-26：两队模型已通过 Tripo 国际版官方 API 生成、自动绑骨、生成动画并接入游戏。没有调用本地生成 API。

## 游戏中的变化

- 潜伏者：黑灰服装、绿色背心、面罩、红色臂章。
- 保卫者：蓝灰服装、护甲、头盔、护目镜。
- 队友、敌人和普通对战机器人使用新模型；本地玩家的第一人称手臂、枪械、持枪画面保持原样。
- 官方待机、行走、跑步、倒地动画与原有瞄准、后坐力、换弹、下蹲、跳跃姿态组合使用。射击动画提供手指握持姿态，双臂通过 IK 对齐实际武器；左手按模型臂长落在护木上。
- 处理了阵营变化、出生保护闪烁、复活、死亡淡出、感染体/BOSS 变身和恢复。模型加载失败时保留原程序化士兵。
- 原逻辑骨架、服务端命中盒与枪口坐标不变。退出对局时释放每个角色的独立骨架、材质与动画实例，共享几何和贴图继续复用。

## 资源与实现

| 文件 | 用途 |
| --- | --- |
| `assets/models/soldier_bl.glb` | 潜伏者，4,391,020 字节 |
| `assets/models/soldier_gr.glb` | 保卫者，4,410,368 字节 |
| `src/soldiermodels.js` | 缓存载入、克隆、骨骼适配、动画混合、持枪 IK、资源释放 |
| `tools/soldier-model-plan.json` | 两队生成提示词与官方参数 |
| `tools/soldier-model-jobs.json` | 实际任务 ID、状态、积分和已失败尝试的记录，无密钥 |
| `tools/tripo-soldiers.mjs` | 可续跑的官方任务提交/查询工具 |
| `tools/soldier-source/` | 官方原始 GLB，用于复现优化 |

两套模型各有 65 根 Mixamo 骨骼及 idle / walk / run / shoot / fall 动作。目标面数 25,000，贴图优化后游戏资源合计约 8.4 MiB。实际下载后的骨架朝向是 +X，通过左右髋骨计算旋转对齐游戏的 -Z；死亡动作的贴地偏移在载入时采样一次。

部署时同时更新 `dist/index.html` 与两个 `assets/models/soldier_*.glb`，服务端原有 `/assets/` 路由即可提供文件。

## 官方调用记录

- 官方入口：`https://openapi.tripo3d.ai/v3`
- 连接：本次通过用户指定的 HTTP 代理 `127.0.0.1:7897`，Node TLS 保持证书验证。
- 生成：`v3.1-20260211`；自动绑骨：`v3.0-20260909`，biped / mixamo / glb。
- 两个角色各消耗：生成 20 + 绑骨检查 0 + 绑骨 25 + 五个动画 50 = 95 积分。
- 合计消耗 **190 积分**，完成时查询到余额 **810 积分**，冻结额度 0。
- 保卫者首次生成任务被内容检查拒绝，已保留失败 ID；改为原创蓝队角色服装描述后成功，没有重复提交结果未知的任务。

密钥仅用于官方 API 请求，未写入项目、前端或任务清单。模型接入后，游戏运行不需要 Tripo 密钥或代理。

如需续查已有任务，使用 Node 24.5+ / 22.21+：

```powershell
# 在当前进程安全设置 TRIPO_API_KEY；不要把真实密钥写入文件。
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
node tools/tripo-soldiers.mjs --check
node tools/tripo-soldiers.mjs --watch
```

已完成任务不会再次生成。POST 结果未知时必须先在官方控制台核对 ID，脚本不会自动重试扣费。任务结果的下载地址有有效期，需通过任务查询重新取得；清单不保存临时签名下载地址。

## 验证与预览

- `npm run test:soldiers`：真实 Chrome / WebGL 中检查模型载入、两队骨架隔离、武器握持、动画、下蹲、跳跃、BOSS 切换、死亡贴地、复活、淡出、释放及加载失败回退。
- `node test/soldier-game.mjs`：最终构建单机预览及两台完整游戏客户端的远端模型验证。
- `npm run test:tripo`：离线验证任务依赖、续跑、防重复提交及绑骨检查，不产生费用。
- 服务端回归 179 项、浏览器联机回归 132 项、BOSS GLB 回归 50 项通过。
- 实测 `src/viewmodel.js`、`src/guns.js`、`src/hitbox.js` 的 SHA-256 与改造前一致。
- 预览：`test/_soldiers_standing.png`、`test/_soldiers_crouch_jump.png`、`test/_soldiers_death.png`、`test/_soldiers_ingame.png`。

官方参考：[中文文档](https://developers.tripo3d.ai/zh)、[自动绑骨](https://developers.tripo3d.ai/en/docs/animations-rig)、[动画重定向](https://developers.tripo3d.ai/en/docs/animations-retarget)。
