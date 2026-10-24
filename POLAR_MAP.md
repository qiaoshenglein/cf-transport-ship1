# 极地中继站

主菜单或联机大厅的地图选项中选择「极地中继站」。支持单机团队竞技、联机 PVP、PVE、观战与 BOSS 附身。

## 布局

- 图幅 84 × 48 米，中心对称；双方各 10 个出生点。
- 中路为快速交战路线，错位通信设备提供掩护。
- 南北运输道适合绕侧，通过横向道路返回中路。
- 四间贯通机房有服务器柜掩体，连接基地和中央区域；主通道净宽 4.2 米、入口净高 4 米。
- 两座雷达天线为远距离方位标，屋顶不是可进入的战斗区域。
- PVE 有 5 个怪物入口，医疗、弹药、护甲各 2 处补给。
- 白天与黄昏两套光照、独立雪地/墙板纹理、小地图参数。

## 实现与资源

`src/map_polar.js` 负责建图、碰撞与雷达生命周期；`src/maps.js` 注册后菜单和服务器自动识别。
地图的战斗结构由 `makeKit` 生成，服务端无头构建同一套碰撞体。
雷达来自用户提供的建模 API，经过贴图压缩后保存为本地 GLB；部署时一并复制 `assets/models/polar-relay-radar.glb`。
模型加载失败时保留屋顶通信基座，不阻断游戏。模型异步到达已退出的地图时立即释放。

## 检查与预览

```powershell
npm run build
npm test
npm run test:map
npm run test:net
npm run test:polar
```

`test:polar` 需要本机 Chrome（可通过 `CHROME_PATH` 指定），验证实际 GLB 加载、贴图档位、退出清理、迟到下载和最终构建页的菜单开局，并输出 `test/_polar_overview.png`、`test/_polar_lane.png`、`test/_polar_dusk.png`、`test/_polar_play.png`。
