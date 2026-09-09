# ForgeMind V7 H3Lite 首批生成素材

## 批次状态

- 生成模型：本地 MiniMax H3Lite，经 ComfyUI API 工作流提交。
- 生成范围：V7 的 11 个镜头全部完成。
- 当前工作流：`D:/Minimax/ComfyUI/user/default/workflows/h3_w4a8_t2v_set_a_compat_api.json`。
- 实际输出规格：640×352、24fps、每条约 5.17 秒。
- 音轨：11/11 均包含 AAC 音轨；音轨只作为非语言背景音底稿，不包含旁白配音流程。
- 旁白：未送入视频模型，按剧本第 6 节后期单独录制。

## 素材清单

| 编号 | 素材 | 用途 |
| --- | --- | --- |
| 01 | `forgemind_v7_01_blank_factory_00001_.mp4` | 空白网格与工厂 ghost |
| 02 | `forgemind_v7_02_goal_to_constraints_00001_.mp4` | 设计目标与约束几何 |
| 03 | `forgemind_v7_03_factory_construction_00001_.mp4` | 工艺节点、楼层和设备成形 |
| 04 | `forgemind_v7_04_robotic_assembly_00001_.mp4` | 机械臂四步装配 |
| 05 | `forgemind_v7_05_agv_navigation_00001_.mp4` | AGV 同层导航、避障与到站 |
| 06 | `forgemind_v7_06_drone_cross_floor_00001_.mp4` | 无人机跨楼层导航 |
| 07 | `forgemind_v7_07_validation_reject_00001_.mp4` | 确定性约束拒绝 |
| 08 | `forgemind_v7_08_branch_candidates_00001_.mp4` | 同源三候选分岔 |
| 09 | `forgemind_v7_09_parallel_simulation_00001_.mp4` | 三候选并行仿真 |
| 10 | `forgemind_v7_10_agent_rollback_00001_.mp4` | Agent 分析与版本回滚隐喻 |
| 11 | `forgemind_v7_11_closing_ecosystem_wall_00001_.mp4` | 片尾生态 Logo 墙背景 |

## 首批 QA 记录

- 01、03、04、05、06、07、08、09、10、11 已抽取中间帧进行快速视觉检查。
- 01、03、04、05、06、07、08、09、10、11 的空间/动作方向符合提示词预期；09 顶部出现模型自动生成的小标牌，后期需裁切或覆盖，不能作为真实 UI。
- 02 出现了设计纸阶段偏复杂的几何物体，保留为初版测试素材；如需要严格的“纸张→约束线”表达，应按详细提示词单独重生成。
- 所有素材均需在正式剪辑前检查完整时间段，不以单帧检查替代动态验收。
