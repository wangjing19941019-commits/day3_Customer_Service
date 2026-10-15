# T-036 Tester 报告

- 任务：T-036 后端：十角色种子、require_roles 与会话 role 字段
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-001`（REQ-004）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 业务 AC-009 / AC-061 由 T-048 真实验收，本任务不判页面联调

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- pytest 9.1.1 + pytest-timeout 2.4.0（`timeout: 120.0s` 已生效）
- 工作目录：`Projects_Repo/Customer_Service`
- 未启动 8099，未调用百炼；未读取或改写运行时业务库
- 测试库：各用例 `tmp_path/test.db`，禁止清表运行时 `backend/data/Customer_Service.db`
- 运行时库指纹（验收前后一致）：长度 622592 字节，LastWriteTimeUtc `2026-09-17 14:38:41`
- 配置：`seed_password` 不在 `AppSettings` 字段中，由 `ConfigManager.get("seed_password")` / raw 读取；报告不写口令、Token 或密钥
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git

调度：`execution_mode=automatic`；`sdd_dispatch.py --running-task T-036` 输出 `gate_phase=frontend_in_progress`（T-035）、`tester_ready=["T-030"]`、T-036 已在 `in_flight_or_queued`。本轮为已在途验收收尾，非新派发。依赖 T-006 状态为 passed。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 十个种子用户名 + 配置键 `seed_password` | POST `/api/sessions` | HTTP 200；`data.username` 与 `data.role` 对齐 §二身份表与 §七用户名 | pytest `test_ten_seed_users_login_with_spec_roles` | 10 个账号均 200；role 与 `SEED_USERS` 一致：employee→employee、agent→frontline_agent、specialist→after_sales_specialist、senior→senior_after_sales、supervisor→supervisor、after_sales_supervisor→after_sales_supervisor、cs_lead→cs_lead、logistics_agent→logistics_after_sales、cs_supervisor→cs_supervisor、admin→admin；响应无 password 字段 | PASS |
| TC-02 | 种子用户名 + 错误密码 | POST `/api/sessions` | 401，`error_code=UNAUTHORIZED`，`error`「用户名或密码错误」 | pytest `test_seed_user_wrong_password_is_unauthorized` | 401，`success=false`，`data=null`，文案与错误码符合契约 | PASS |
| TC-03 | 无 Token 访问业务路由 | GET `/api/documents` | 401，`error`「请先登录」，`error_code=UNAUTHORIZED` | pytest `test_business_route_without_token_is_unauthorized` | 401，信封与文案符合契约 | PASS |
| TC-04 | 坐席 `agent`（role=`frontline_agent`）调模板路由 | GET `/api/prompt-templates` | 403，`error_code=FORBIDDEN`（空模块可断言） | pytest `test_agent_cannot_access_prompt_templates` | 403，`success=false`，`data=null`，`FORBIDDEN`；空模块 `require_roles("admin")` 已挂载 | PASS |
| TC-05 | `.env.example` | 读文件 | 列出 `seed_password` 与 §七字段名占位；无真实密钥；无 `sk-` / `Bearer ` 片段 | pytest `test_env_example_lists_seed_password_and_spec_keys` + 独立 grep | 全部 `_SPEC_CONFIG_KEYS` 含 `key=`；grep 无 `sk-` / `Bearer ` | PASS |
| TC-06 | 已登录调 API-002 | GET `/api/sessions/current` | 200，`data` 含 username/role；`users.last_seen_at` 从空变为有值 | pytest `test_current_session_updates_last_seen_at` | 调用前 `last_seen_at` 为 null；200 后非空；`data={"username":"agent","role":"frontline_agent"}` | PASS |
| TC-07 | 无百炼 Key | 仅跑本地 pytest | 不阻塞本任务 | 本轮未启服务、未调百炼；测试用占位 `llm_api_key` | 14 passed，无外部调用 | PASS |

补充（任务描述，非新需求）：

| 项 | 结果 |
| --- | --- |
| 旧共享账号补 `role=employee`，不删行 | `test_old_shared_account_kept_as_employee` PASS |
| users 表含 `role`、`last_seen_at` | `test_orm_tables_and_password_hash` PASS |
| API-001/002 加法 username/role | `test_sessions` 登录 200 含 role；API-002 200 含 username/role |
| 缺 Token 调 API-002 | `test_current_session_without_token` PASS（401「请先登录」） |

## 实际执行

```
.\.venv\Scripts\python.exe -m pytest backend/tests/test_roles.py backend/tests/test_sessions.py --timeout=120 -v --tb=short
```

- 退出码 0
- `collected 14 items`
- `====================== 14 passed, 48 warnings in 25.51s =======================`
- 警告来自 Starlette/Pydantic deprecation 与 pycore，不计入本任务 FAIL
- 未重跑全量 `backend/tests`（Developer 自称 103 passed；本任务 technicalChecks 由上述 14 项覆盖）

## AC

本任务 `acceptanceCriteria=[]`。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-009 | 不在本任务判定 | 页面三角色登录分流归 T-048（及既有 T-010 证据不可单独代替本轮十角色种子） |
| AC-061 | 不在本任务判定 | 坐席打不开模板/灰度、管理可打开，归 T-048 真实联调 |

## 未验项

- 真实 8099 直播 HTTP（按派发：本轮为 technicalChecks，不启 8099）
- 百炼调用（任务写明无 Key 不阻塞）
- 管理端模板路由 200 业务内容（空模块只验坐席 403）
- 关闭 Mock 后的页面角色分流与 403 一致性（T-048）

## 范围外

- pycore Pydantic v2 deprecation 警告，不计入 FAIL
- 未把 `seed_password` 扩进 `AppSettings`；种子与 403 行为已通过，不扩大范围
