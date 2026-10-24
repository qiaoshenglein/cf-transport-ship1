# 极地中继站雷达资产

- 用途：`polar` 地图两座机房屋顶上的通信地标。只参与渲染，不参与碰撞。
- 来源：用户指定的本机 Tripo3D 工作流 API，`POST /v1/jobs`，文本生成，50,000 面档位。
- 作业 ID：`b21b0d5c-ff6c-4082-a9cb-c5b7dc95da40`。
- 上游任务 ID：`f50daf91-e7f4-4d50-a708-c23a3707a75c`。
- 原始 GLB SHA-256：`e73fe43c970b8fc8ca5765f52c968b66180915bf0eee2ffc0e10dc6d5637e4a3`。
- 实际几何：49,992 三角面，41,165 顶点；两处地标共享同一份几何、材质和贴图。
- 项目版本：几何和 UV 不变，三张 4096² 贴图缩至 1024²；颜色使用 JPEG，法线与金属/粗糙度保持 PNG。
- 大小：31,090,768 → 3,556,044 字节。模型随地图加载，离开地图时释放。

生成提示词：

> A single industrial polar research station satellite radar dish antenna on a compact metal pedestal. Large concave white parabolic reflector tilted upward 45 degrees, dark navy steel truss supports, one orange maintenance housing. Realistic game environment prop, weathered painted metal, subtle snow on top edges. Complete freestanding object, centered, no surrounding terrain, no people, no text, no wires extending outside. Low polygon optimized geometry, one compact structure.

重新处理原始 API 输出：

```powershell
node tools/optimize-polar-radar.mjs <原始GLB路径> assets/models/polar-relay-radar.glb
```

验证：`npm run test:polar`。无需启动建模 API 即可运行已完成的地图。
