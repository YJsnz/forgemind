# ForgeMind AI 服务（FastAPI）

离线 AI / LLM 编排服务（补充设计 §5.1：只做离线，绝不进实时仿真链路）。

## 安装 & 运行

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## 接口

- `GET /api/ai/health` — 健康检查
- `POST /api/ai/assistant` — AI 助手占位入口（当前返回 stub，未接真实 LLM）

```bash
curl -X POST http://localhost:8000/api/ai/assistant \
  -H "Content-Type: application/json" \
  -d '{"question": "怎么提高产量？"}'
```

## 职责边界（§5.2）

- 与 Spring Boot 用**异步消息**（Redis Stream / Kafka）通信，本骨架先以 HTTP 占位。
- LLM 只做**动作库选型 + 结构化 schema 填参**，产出数字以副本仿真为准，不自由改工厂。
