# ForgeMind 后端数据库设计（MySQL 8.4）

## 1. 落地边界

当前制作阶段先把静态工厂设计和用户数据持久化起来：用户、登录会话、工厂、楼层、物品、配方、配方端口、设施布局。

`ItemLot`、机器加工进度、传送带槽位和高频位置不直接写 MySQL，它们仍由仿真引擎持有；`simulation_snapshot` 只用于后续保存可复现的低频快照。

## 2. 数据库

```text
数据库：forgemind
字符集：utf8mb4
引擎：InnoDB
开发端口：3306
默认开发账号：forgemind / forgemind
```

## 3. 表职责

| 表 | 当前用途 |
| --- | --- |
| `app_user` | 用户账号和 BCrypt 密码哈希 |
| `auth_session` | 持久化登录会话，数据库只保存 token SHA-256 |
| `factory` | 工厂名称、归属用户、存档版本 |
| `factory_member` | 工厂成员与角色，为多人协作预留 |
| `floor` | 多楼层结构；当前默认创建 A-01 主楼层 |
| `item` | 工厂级物品类型定义 |
| `recipe` | 工厂级生产配方定义 |
| `recipe_port` | 配方输入/输出端口及数量；端口与配方的同工厂关系由数据库级联维护 |
| `factory_object` | 设备类型、网格坐标、旋转、配方/物品绑定；绑定 ID 由后端按工厂范围校验 |
| `factory_connection` | 设备端口连接，当前前端仍主要按网格方向推导 |
| `simulation_snapshot` | 低频仿真快照，为回放/副本仿真预留 |

## 4. 暂不建表的运行态

以下数据不进入实时 CRUD：`item_lot`、机器实时状态、传送带槽位、AGV 每 tick 坐标、临时 AI 副本的中间状态。后续需要历史分析时，再以批量快照或时序表方式写入，避免把 MySQL 变成每帧状态总线。

## 5. 初始化

```powershell
docker compose up -d mysql
cd backend
mvn spring-boot:run
```

Spring Boot 启动时由 Flyway 执行 v1–v4 迁移。v2–v4 专门处理复合主键下的可空绑定和级联删除边界；连接信息可通过 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` 覆盖。

仓库内的 `backend/data/factory.json` 与 `backend/data/users.json` 是早期 JSON 方案留下的历史文件，当前启动流程不会读取或写入它们；对应的 `JsonStore`、`UserStore` 仅保留人工迁移/查看用途，不再作为 Spring Bean。
