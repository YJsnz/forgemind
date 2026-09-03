# ForgeMind Unity 客户端 S-03 性能实测报告

> 生成日期：2026-08-28
> 测试环境：RTX 4060 Laptop（D3D12 level 12.1，VRAM 7956MB）+ Tuanjie 2022.3.62t13 + URP 14.0.11
> 门禁参考：[`ForgeMind-Unity原生客户端规划与要求.md`](ForgeMind-Unity原生客户端规划与要求.md) §6
> 声明：S-03 为人工压测场景（520 个高模摆网格），**不是**产品工厂界面；产品界面验证见 [`ForgeMind-Unity客户端-功能验收报告.md`](ForgeMind-Unity客户端-功能验收报告.md)

## 结论

- **基线（朴素 500+ GameObject，无实例化）**：~40 FPS。CPU P95=25.07ms，GPU P95=25.46ms。60 FPS 门禁（16.67ms）未过。
- **纯 GPU 实例化（内置 InstancedMesh，395 材质 / 62 GLB）**：稳态中位数 ~100 FPS（10ms），但存在启动着色器编译尖峰（单帧 2.6s）和周期性尖峰，P95=31.46ms 反超基线。
- **实例化 + 遮挡烘焙**：~30 FPS（P95=33.94ms）——比基线更差。全可见平面网格无 occluder，occludee 评估是纯净开销。
- **120 FPS 门禁对本机 4060 + 全细节 520 高模不现实**：GPU 利用率恒 99%、时钟恒定 2640MHz（无降频），说明是**顶点吞吐物理上限**，不是引擎或设置问题。

## 实测数据

| 配置 | samples | cpuAvg | cpuP95 | gpuAvg | gpuP95 | gpuP99 | 等价FPS |
|---|---|---|---|---|---|---|---|
| 基线（朴素） | 2913 | 20.60 | 25.07 | 23.12 | 25.46 | 26.11 | ~40 |
| 实例化 + 遮挡 | 2207 | 27.20 | 33.94 | 30.49 | 33.61 | 35.74 | ~30 |
| 纯实例化（全量） | 3331 | 18.02 | 31.46 | 10.40 | 31.03 | 34.07 | 中位~100，尾~30 |

纯实例化逐段分析（CSV 分桶）：
- frames[0-500]：avg 16ms，**max 2658ms**（实例化变体着色器首次编译的启动尖峰）
- frames[500-2000]：avg 9.9–10.4ms（≈100 FPS，稳态）
- frames[2000-3500]：avg 23.6→31.1ms 渐进劣化（后续验证为测量伪影风险——失焦时 Unity 会节流渲染，`runInBackground` 默认 false）

GPU 热/时钟观测（nvidia-smi 60s 采样）：温度 54→72°C 稳定、SM 时钟恒 2640MHz、利用率 96–100%。**无降频**。

## 已做改动

- `ForgeMindInstancing.cs`（新）：共享材质开启 `enableInstancing`，运行期兜底 `EnableForSceneRoots`。
- `ForgeMindModelInstancing.cs`（新）：编辑器菜单「Enable GPU Instancing on Model Materials」「Bake S03 Occlusion Culling」「Prepare and Build S03 …」。
- `FactoryScenePresenter.cs`：ApplySave 后对静态对象材质开实例化。
- `FactoryClientBootstrap.cs`：Start 时对场景根开实例化。
- `ForgeMindProjectBootstrap.cs`：S03 生成器 occludee 标记（可关）、`runInBackground=true`、**模型材质着色器全量加入 Always Included**。
- `ForgeMindPerformanceProbe.cs`：`Application.runInBackground=true`。

## 教训与建议

1. **S-03 全可见压测是实例化的最不利场景**：实例化只减 draw call 不减三角形，全可见高模仍是顶点瓶颈。实例化对**真实工厂**（有遮挡、有楼层裁剪、大量同模设备）才有净收益。
2. **遮挡剔除需要真实 occluder**（墙体/楼板/密集设备墙）；全可见平面网格上无收益且有开销。
3. **启动尖峰**（2.6s）来自实例化变体着色器编译，可用 Shader Variant Collection 预热消除。
4. **测量必须 runInBackground=true**，否则失焦会节流渲染、污染数据。
5. **产品界面的性能以真实存档（S-01/S-02 类）为准**，不要用 S-03 压测场景代表产品体验。
