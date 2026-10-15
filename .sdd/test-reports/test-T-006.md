# T-006 Tester 报告

- 任务：T-006 后端：共享账号登录与恢复登录态
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-001`（REQ-004）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-12
- 页面闭环 AC-009 / AC-010 / AC-025 / AC-026 由 T-010 承接，本任务不验收

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（3.13.15）
- 工作目录：`Projects_Repo/Customer_Service/backend`，`PYTHONPATH=..`
- 端口：本轮启动前 8099 空闲；Tester 自行启动 uvicorn，验收后已关闭
- 指纹：OpenAPI `title=Customer Service API`；路径仅 `POST /api/sessions`、`GET /api/sessions/current`、`GET /health`；无登出接口
- 配置：无 `backend/.env`，进程读 `.env.example` 占位；报告不写密钥/token/密码全文
- 业务库：`backend/data/Customer_Service.db`（相对 backend/ 解析为绝对路径）
- 未改 frontend；未改 `.sdd/tasks.json` / PRD / tech-spec / 业务代码

## 检查表

| ID | 场景 | 预期 | 方法 | 结果 |
| --- | --- | --- | --- | --- |
| TC-01a | uvicorn 127.0.0.1:8099 | 本轮代码可启动 | 自行启动并 HTTP | PASS |
| TC-01b | pytest 正确登录 | 200，`access_token` + `username` | pytest + 直播 HTTP | PASS |
| TC-01c | 错误密码 | 401，「用户名或密码错误」 | pytest + 直播 HTTP | PASS |
| TC-01d | 缺 token 调 API-002 | 401，「请先登录」 | pytest + 直播 HTTP | PASS |
| TC-02a | pycore 信封 | success/data/error/error_code/message/timestamp/request_id/metadata | HTTP JSON | PASS |
| TC-02b | 密码不回传 | data 无 password，响应体无明文密码 | pytest + HTTP | PASS |
| TC-02c | JWT 有效期 | 约 `jwt_expire_minutes=720` | pytest 断言 + 直播 JWT 剩余约 719.98 分钟 | PASS |
| TC-02d | 密钥位置 | 真实密钥只应在 `.env`；example 仅占位 | 无 `.env`；example 为占位；gitignore 含 `.env` | PASS |
| TC-03a | ruff/mypy 范围 | 仅 `backend/src` 与 `backend/tests` | pyproject 配置 + 命令 | PASS |
| TC-03b | 不改 pycore | 本任务不修改框架 | git：pycore 为未跟踪框架副本，无对本任务的框架改动证据 | PASS |

补充（任务描述，纳入本轮技术核对，非新需求）：

| 项 | 结果 |
| --- | --- |
| ORM 六表 users/documents/chunks/faqs/conversations/messages | 测试库与业务库均存在；列与 §三一致 |
| 启动写共享账号哈希 | users 仅 1 行 `it-help`，哈希 `$2b` 前缀，非明文 |
| CORS 5199/5175 四条 origin | OPTIONS 200，`access-control-allow-origin` 与请求 Origin 一致 |
| `.env.example` 覆盖 §七全部字段 | 31 项均有占位 |
| 空 documents/conversations 路由 | 已挂载；OpenAPI 无业务端点 |
| 无独立登出 | OpenAPI 无 DELETE/logout |

## 实际执行

```
python -m pytest backend/tests --timeout=120
# 7 passed in 9.92s（pytest-timeout 2.4.0 已就位）

python -m ruff check backend/src backend/tests
# All checks passed

python -m mypy backend/src backend/tests
# Success: no issues found in 19 source files

cd backend && PYTHONPATH=.. python -m uvicorn src.main:app --host 127.0.0.1 --port 8099
```

直播 HTTP（脱敏）：

- `POST /api/sessions` 正确占位账号 → 200，`success=true`，`data` 含 `access_token`/`token_type=bearer`/`username=it-help`
- 错误密码 → 401，`error=用户名或密码错误`，`error_code=UNAUTHORIZED`
- 缺字段 → 400，`error=请输入用户名和密码`，`error_code=VALIDATION_ERROR`
- `GET /api/sessions/current` 无 Token → 401，`error=请先登录`
- 带 Token → 200，`data={"username":"it-help"}`

## AC

本任务 `acceptanceCriteria=[]`。F-001 / REQ-004 的 AC-009、AC-010、AC-025、AC-026 由 T-010 在关闭 Mock 后做页面闭环，本轮不判这些 AC。

## 未验项

- 真实 `.env` 密钥下的登录（本地无 `.env`，按 example 占位验证）
- 页面登录/退出与三角色入口（T-010）
- 知识入库、提问、转人工（后续后端任务）

## 范围外

- `pycore` 为项目内未跟踪框架副本；Pydantic v2 deprecation 警告来自框架，不计入本任务 FAIL
- 前端门禁仍在 T-005；本任务为独立后端阶段验收
