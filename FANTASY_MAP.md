# 风栖庭院

一张参考明亮动漫幻想冒险美术的原创地图：草地、浅色石拱、青蓝屋顶、花圃、城堡尖塔和远山。沿用现有第一人称武器与团队竞技/PVE 玩法。

- 尺寸：96 × 64 米；三条东西向路线，四条横向连接路。
- 中路：开放六柱凉亭与错位掩体，屋顶的风元素祭坛构成视觉地标。
- 侧路：两座四面贯通庭馆、花篱与石拱，支持推进和回防。
- 双方各 10 个出生点，基地屏障遮住直接对射线；6 个补给点、5 个怪物入口。
- 主菜单、联机大厅、小地图、机器人导航、白天/黄昏和后台开启/禁用均使用统一地图注册表。

## Tripo 国际版模型

使用官方 `https://openapi.tripo3d.ai/v3/generation/text-to-model`，模型版本 `v3.1-20260211`，每件上限 16,000 面，PBR 贴图。没有使用本地模型生成 API。

| 资产 | 游戏文件 | 实例 | 官方任务 ID | 消耗额度 |
| --- | --- | --- | --- | --- |
| 幻想风车 | `assets/models/fantasy-windmill.glb` | 场外两座 | `404f2609-cdef-4bc7-a158-01b8f1bf0fbb` | 20 |
| 古树 | `assets/models/fantasy-windtree.glb` | 场外四棵 | `8b69be0d-ac03-4679-99aa-7f4bc6edc6d3` | 20 |
| 风元素祭坛 | `assets/models/fantasy-windshrine.glb` | 凉亭及庭馆屋顶三座 | `0b9e6e1d-9f5f-4059-9aa9-6b2e73b1ef63` | 20 |

三件模型总计消耗 60 点额度。提示词和生成参数保存在 `tools/fantasy-model-plan.json`，任务记录在 `tools/fantasy-model-jobs.json`，原始文件在 `tools/fantasy-source/`。密钥未写入项目。

贴图缩至最多 1024 像素，保留生成的几何和 UV，部署 GLB 总计约 8.85 MiB。同类实例共享几何、材质和纹理。模型均位于战斗通路之外，权威碰撞不依赖网络下载。换图会释放资产；切图后才完成的异步加载也会回收。

## 部署与验证

重新构建并重启服务后，在选图菜单选择“风栖庭院”。部署时须一起复制上述三件 GLB。游戏运行时从本项目读取模型，无需再次访问 Tripo 或提供 API 密钥。

```powershell
npm run build
npm run test:map
npm test
npm run test:newmaps
npm run test:maps-admin
npm run test:net
```

浏览器测试检查客户端/服务端碰撞一致、三件 GLB 加载与九个场景实例、换图回收，以及实际构建页的选图和开局。预览输出为 `test/_windgarden_overview.png`、`test/_windgarden_lane.png`、`test/_windgarden_dusk.png`。
