# 潜伏者 / 保卫者模型改造

## 当前状态（2026-10-26）

尚未提交生成任务，尚未替换游戏角色。当前机器访问 Tripo 国际版官方 API 时出现连接超时或 TLS 连接重置，未取得 API 的认证响应。不能据此判断密钥是否有效或余额是否充足。

已准备两队的提示词和官方任务流程。第一人称模型与游戏运行代码均未改动。

## 已准备内容

- `tools/soldier-model-plan.json`：潜伏者黑灰轻装、红色臂章；保卫者蓝灰制服、头盔护甲。无自带枪械，方便挂接现有武器。每个模型目标 25,000 面，PBR 贴图。
- `tools/tripo-soldiers.mjs`：官方 v3 文生模型 → 绑骨检查 → v3 人形 Mixamo 绑骨 → 待机、行走、跑步、射击、倒地动画。只使用 `https://openapi.tripo3d.ai/v3`，不会调用本地 API。
- `test/tripo-soldiers.mjs`：离线验证依赖、续跑、防重复提交和不可绑骨时停止处理，不会消耗 API 积分。

密钥只从进程环境变量 `TRIPO_API_KEY` 或 `--key-stdin` 读取，不保存在项目文件。已配置的 `HTTPS_PROXY` / `ALL_PROXY` 会由 curl 使用；保持 HTTPS 证书验证。请求密钥通过 stdin 传递，不出现在 curl 的命令行参数中。

## 网络恢复后的执行

```powershell
# 先在当前进程安全设置 TRIPO_API_KEY；不要将真实密钥写进脚本或提交到仓库。
node tools/tripo-soldiers.mjs --check
node tools/tripo-soldiers.mjs --watch
```

不加 `--watch` 时执行一轮提交/查询后退出。状态保存在 `tools/soldier-model-jobs.json`，恢复运行不会重复提交已有任务。若 POST 结果未知，脚本停止自动重试，需要先在官方控制台核对任务 ID，再补入对应阶段记录。进程被强制终止留下 `.lock` 时，确认没有运行实例后才能移除锁。

任务成功后需要查询官方任务结果并下载 GLB，检查实际骨骼和动画内容，再完成游戏接入；脚本不会把未经验证的模型自动上线。

## 后续接入与验收

1. 下载、检查两队模型，压缩贴图，核对朝向、脚底、高度、关节与蒙皮。
2. 第三人称外观挂到 Soldier；保留原逻辑骨架与命中盒，避开第一人称 `viewmodel.js`。
3. 按实际导出的骨骼结构适配持枪 IK、枪口、换弹、蹲下、跳跃及死亡，处理动作过渡。
4. 兼容队伍变化、感染/恢复、BOSS 外观、保护闪烁、复活和资源释放。
5. 做模型视觉检查与游戏/联机回归后，才认为替换完成。

## 官方文档

- https://developers.tripo3d.ai/zh
- https://developers.tripo3d.ai/zh/docs/introduction
- https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard
- https://developers.tripo3d.ai/en/docs/animations-rig
- https://developers.tripo3d.ai/en/docs/animations-retarget
