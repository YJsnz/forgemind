-- The public ForgeLab examples are system-authored snapshots. Their author
-- account is intentionally nullable so the examples survive account cleanup.
INSERT INTO forgelab_post (id, author_name, author_role, section, tag, title, summary, content, icon_key, created_at) VALUES
('wzh-line', 'ForgeMind Studio', 'MAINTAINER', 'archive', 'FACTORY SAVE', 'WZH 三层轻量完整产线：从毛坯到已检成品', '39 个对象、2 台 AGV、2 架跨层无人机，保留真实有限货架和三段可运行工艺，适合作为多楼层物流的起点。', '这是一份可以直接打开复盘的三层工厂存档。L1 负责毛坯入库与首段加工，L2 完成中间装配，L3 负责视觉检测和成品出货。每一层都保留清晰的输入、加工、输出关系，避免用演示数据替代真实物流。\n\n存档包含 39 个对象、2 台 AGV、2 架跨层无人机、有限容量货架、存取站和入货/出货边界。固定种子运行 600 秒，实际消耗 196 件钢制毛坯并交付 58 件已检成品。建议先从 L2 的跨层接口开始检查，再观察车辆在库存阈值变化时的接驳。\n\n复用时请保留版本号、随机种子和运行时长，这样其他设计者可以比较自己的布局是否真的改善了吞吐。', 'archive', '2026-08-21 09:00:00.000000'),
('cnc-kit', 'Mori', 'MODEL MAKER', 'models', 'MODEL KIT', 'CNC Housing 设备模型包与端口说明', '包含模型预览、占地、接口方向和许可说明，下载前可先在资源预览器中检查包围盒。', '这个资源包适合需要快速搭建机械加工单元的设计者。模型采用 GLB 格式，按设备本体、接口标记和预览材质拆分，共 6 个文件。导入前建议先检查包围盒、最低点和原点位置，避免模型显示正常但放置足迹偏移。\n\nCNC Housing 的占地、输入端和输出端方向已经在说明页标出。接入传送带时，以端口接触和对象物流方向为准，不要只依赖模型外观判断可连接位置。\n\n许可：CC BY 4.0。使用时请保留原作者署名和来源链接；如果调整了材质、比例或接口，请在自己的分享中写清修改声明。', 'box', '2026-08-20 09:00:00.000000'),
('cross-floor', 'Lin / Layout Lab', 'DESIGNER', 'layout', 'FIELD NOTE', '跨层传送带怎样留出维护通道？', '一条从坡度、楼板净空到 AGV 回转空间的布局复盘，附 1m 网格下的避让检查清单。', '跨层物流最容易被忽略的不是坡度，而是坡道落点和维护路径同时占用了同一片空间。我的做法是先锁定 1m 网格，再为坡道保留连续的水平投影，最后把 AGV 回转半径作为不可被设备侵入的通道。\n\n检查顺序建议固定为：一，确认上下楼层接口方向一致；二，检查坡道与楼板底的净空；三，确认落点前后至少留出一个可检查的直段；四，运行确定性仿真，看库存增长时是否出现背压。只要其中一项没有证据，就不要用视觉上的“看起来能过”替代验证。\n\n这套方法并不追求把每一格都塞满，而是让后续换机、查线和定位堵塞都有可走的路径。', 'layout', '2026-08-18 09:00:00.000000'),
('signal-first', 'Qiao', 'PRODUCT DESIGNER', 'design', 'DESIGN NOTE', '先画信号，再画设备：数字工厂的设计顺序', '把输入、加工、输出和诊断信号作为第一层关系，设备造型反而会更快收敛。', '我把工厂设计拆成三张图：第一张只画物料输入、加工、输出和边界；第二张补上设备足迹、端口和运输方式；第三张才处理模型造型、颜色和动效。这样做的好处是，结构关系不会被漂亮的设备外观带偏。\n\n每一条连接都要能回答三个问题：它从哪里来、交给谁、堵住以后在哪里能看到证据。对于没有下游的开放端，先标记为待处理信号，不要用装饰性的箭头假装已经连通。\n\n设计评审时，我会把目标、约束和验证结果放在同一页。即使方案最后没有采用，也能留下可复用的判断，而不是只留下截图。', 'compass', '2026-08-16 09:00:00.000000'),
('resource-rule', 'ForgeMind Studio', 'MAINTAINER', 'notice', 'COMMUNITY RULE', 'ForgeLab 资源分享许可与署名规范', '分享工业、公模和私有模型前，请写清来源、许可、修改声明与可使用范围。', 'ForgeLab 接受资源分享，但不替作者推断许可。每一份模型、贴图、音频或存档都应注明来源、原始许可、是否修改，以及其他人可以怎样使用。\n\n如果来源不明、许可限制尚未确认，帖子应明确标为“待复核”，不能写成 ForgeMind 原创，也不能承诺可以自由商用。工业资产、公模资产和用户私有模型需要分开说明，附件名称也尽量保留原始版本信息。\n\n遇到不确定的资源，请先分享检查过程和链接，等待作者或维护者补充，而不是删除上下文。可追溯比“看起来完整”更重要。', 'megaphone', '2026-08-15 09:00:00.000000'),
('inspection-cell', 'YJ', 'BUILDER', 'archive', 'FACTORY SAVE', '视觉检测工作台：PCB 检测链路演示档', '一个独立视觉检测单元的演示存档，记录相机、检测结果和离线模型状态的边界。', '这是一个独立视觉检测单元的演示存档，重点不是追求一个神奇的检测分数，而是把相机采集、检测结果、合格/不合格分流和离线模型状态边界写清楚。\n\n演示中相机和检测台属于生产链路，离线模型只负责提供可解释的检测辅助结果，不直接改变物料数量、碰撞结论或寻路结果。运行时可以暂停，逐步查看一块 PCB 从进入、检测到分流的状态变化。\n\n复盘时建议记录检测条件、样本范围和失败案例。只附一张成功截图不能说明模型适用于其他工厂，也不能替代真实现场的验证。', 'file-code', '2026-08-12 09:00:00.000000');

INSERT INTO forgelab_attachment (id, post_id, file_name, kind, content_type, size_bytes, external_url) VALUES
('seed-cnc-glb', 'cnc-kit', 'cnc-housing.glb', 'archive', 'model/gltf-binary', 1468006, '/models/industrial/cnc_machining_center.glb'),
('seed-inspection-video', 'inspection-cell', 'inspection-pcb-demo.mp4', 'archive', 'video/mp4', 0, '/videos/inspection-pcb-demo.mp4');

INSERT INTO forgelab_reply (id, post_id, author_name, author_role, content, created_at) VALUES
('wzh-r1', 'wzh-line', 'Mori', 'MODEL MAKER', 'L2 跨层接口的方向说明很清楚，尤其是把端口接触和模型外观分开验证，这个提醒很有用。', '2026-08-23 09:00:00.000000'),
('wzh-r2', 'wzh-line', 'Lin / Layout Lab', 'DESIGNER', '我按你给的种子复跑后，先检查了 L2 的落点，AGV 回转空间确实比视觉上更容易被忽略。', '2026-08-23 10:00:00.000000'),
('wzh-r3', 'wzh-line', 'Qiao', 'PRODUCT DESIGNER', '建议后续补一张三层输入输出关系图，方便第一次打开存档的人快速定位边界。', '2026-08-24 09:00:00.000000'),
('wzh-r4', 'wzh-line', 'ForgeMind Studio', 'MAINTAINER', '收到，下一版会把版本号、固定种子和复盘入口放到项目说明里，保持结果可追溯。', '2026-08-24 10:00:00.000000'),
('cnc-r1', 'cnc-kit', 'YJ', 'BUILDER', '这个包的最低点和原点说明解决了我之前导入后足迹偏移的问题，感谢。', '2026-08-26 09:00:00.000000'),
('cnc-r2', 'cnc-kit', 'Lin / Layout Lab', 'DESIGNER', '许可信息写得很完整。调整材质后我会把修改声明和来源链接一起保留。', '2026-08-27 09:00:00.000000'),
('cnc-r3', 'cnc-kit', 'Mori', 'MODEL MAKER', '如果发现接口方向和预览不一致，请带上旋转值和包围盒截图，我会在资源包里补校验表。', '2026-08-27 10:00:00.000000'),
('cross-r1', 'cross-floor', 'WZH', 'BUILDER', '我以前只看坡度，后来在落点前加了一段直线，维护和排查都顺了很多。', '2026-08-25 09:00:00.000000'),
('cross-r2', 'cross-floor', 'ForgeMind Studio', 'MAINTAINER', '“不要用看起来能过替代验证”很适合做布局评审的检查项，已加入社区建议。', '2026-08-25 10:00:00.000000'),
('cross-r3', 'cross-floor', 'Mori', 'MODEL MAKER', '如果跨层接口旁边还要放存取站，建议先算 4×4 足迹，再确定坡道落点。', '2026-08-26 09:00:00.000000'),
('signal-r1', 'signal-first', 'Lin / Layout Lab', 'DESIGNER', '三张图的顺序很适合团队评审，先把物流关系钉住，再讨论设备造型。', '2026-08-22 09:00:00.000000'),
('signal-r2', 'signal-first', 'YJ', 'BUILDER', '开放端标成待处理信号这点很重要，之前确实会被装饰箭头误导。', '2026-08-22 10:00:00.000000'),
('signal-r3', 'signal-first', 'Qiao', 'PRODUCT DESIGNER', '我会把“从哪里来、交给谁、堵住后在哪里有证据”放进下一次设计走查模板。', '2026-08-23 09:00:00.000000'),
('rule-r1', 'resource-rule', 'Mori', 'MODEL MAKER', '同意，来源不明的资源宁可标待复核，也不要为了列表好看直接写成可商用。', '2026-08-21 09:00:00.000000'),
('rule-r2', 'resource-rule', 'ForgeMind Studio', 'MAINTAINER', '工业资产、公模和私有模型分开记录，后续检索和迁移都会更稳。', '2026-08-21 10:00:00.000000'),
('rule-r3', 'resource-rule', 'Qiao', 'PRODUCT DESIGNER', '建议附件文件名也带上版本号，这样下载后脱离帖子仍然能找到来源。', '2026-08-22 09:00:00.000000'),
('inspection-r1', 'inspection-cell', 'YJ', 'BUILDER', '演示里把离线模型和仿真事实分开很关键，检测辅助结果不应该改写物料数量。', '2026-08-19 09:00:00.000000'),
('inspection-r2', 'inspection-cell', 'WZH', 'BUILDER', '希望后续能看到一组失败样本，这样比只看通过画面更容易判断边界。', '2026-08-20 09:00:00.000000'),
('inspection-r3', 'inspection-cell', 'ForgeMind Studio', 'MAINTAINER', '会补充检测条件、样本范围和失败案例，保持演示结果可复盘。', '2026-08-20 10:00:00.000000');
