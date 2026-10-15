# T-044 Tester 报告

- 任务：T-044 后端：工作区大额订单金额线 API-034/035
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-007`（REQ-010）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 确认工单时按金额打标归 T-050；本任务不判工单确认闭环

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- pytest 9.1.1 + pytest-timeout 2.4.0（`timeout: 120.0s` 已生效，插件已安装）
- 工作目录：`Projects_Repo/Customer_Service`
- 仓库指纹：harness 根 `git rev-parse --short HEAD` = `ec75f8f`；项目内 `Customer_Service` 工作树尚无提交
- 改动指纹（SHA256）：
  - `workspace_settings.py` 路由 `F72FBA2CD2F41D94B41E86DE2C9C6ACED3B3E3E5BB8597197135AD48EAC30FC8`
  - `workspace_settings.py` 服务 `2433D03822347932BFFB4B16E4FB237975E8809D1E6C453540F2F3590EB526CD`
  - `models/workspace.py` `8030ECDA2C2F41D4DDE5FD4873C9497C69B55072D86D61440F946E6AC2A34BA7`
  - `tests/test_workspace_settings.py` `6E66B0F0021FA23464CE5320C444D326F0455A1B3496E2C105D5ACAAF9B47F9B`
- 未启动、未停止 8099；未调用百炼；未读取或改写运行时业务库
- 测试库：pytest 用 `tmp_path/test.db`；抽检另用系统临时目录 `iso.db`，路径不等于 `backend/data/Customer_Service.db`
- 运行时库指纹（验收前后一致）：长度 622592 字节，LastWriteTime `2026-09-17 22:38:41`
- 报告不写口令、Token 或密钥
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git 写操作

调度：`execution_mode=automatic`；`sdd_dispatch.py --running-task T-044` 输出 `gate_phase=frontend_in_progress`（T-035）、`tester_ready=["T-037"]`、T-044 已在 `in_flight_or_queued`。本轮为编排器指定的在途验收收尾，非 integration/delivery。依赖 T-036 状态为 passed。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | admin 登录后 PATCH `{ "high_risk_amount_threshold": 1000 }` | GET `/api/workspace-settings` | HTTP 200；GET `data` 与 PATCH 一致 | pytest `test_admin_patch_value_then_get_matches` | PATCH 200，`data={"high_risk_amount_threshold": 1000}`；随后 GET 200 且相同 | PASS |
| TC-02 | admin PATCH 数值后再 PATCH `null` | GET 后用金额线判定函数，金额 999999 | 持久化为 `null`；不升 `vip` / `high_risk` | pytest `test_patch_null_does_not_elevate_vip_or_high_risk_by_amount` | GET 阈值为 `null`；`urgency_elevated_by_amount(999999, None)` 为 `None` | PASS |
| TC-03 | 一线坐席 `agent`（role=`frontline_agent`）PATCH 金额线 | PATCH `/api/workspace-settings` | 403，`error_code=FORBIDDEN` | pytest `test_frontline_agent_patch_is_forbidden` + 抽检 | 403，`success=false`，`data=null`，`FORBIDDEN` | PASS |
| TC-04 | 主管 `supervisor` GET | GET `/api/workspace-settings` | 200；未配置为 `null` | pytest `test_supervisor_get_is_ok` | 200，`success=true`，`data={"high_risk_amount_threshold": null}` | PASS |
| TC-05 | `.env.example` | 读文件 | 不增加密钥字段；无 `sk-` / `Bearer `；金额线不进环境变量 | pytest `test_env_example_does_not_add_secret_fields` + 独立 grep | 无 `high_risk_amount_threshold=`、无 `workspace_settings`、无 `sk-` / `Bearer `；金额线走表存储 | PASS |
| TC-06 | 已配置金额线 | `urgency_elevated_by_amount` | 达线标 `high_risk` 不标 `vip`；未达线 / 未配置为 `None` | pytest `test_configured_amount_line_marks_high_risk_not_vip` | `1000>=1000` → `high_risk`；`999` 与 `None` → `None` | PASS |
| TC-07 | 主管 PATCH | PATCH `/api/workspace-settings` | 403 FORBIDDEN（API-035 仅 admin；主管只读） | 隔离 TestClient 抽检 | 403，`error_code=FORBIDDEN` | PASS |
| TC-08 | 一线坐席 GET | GET `/api/workspace-settings` | 403（API-034 仅 admin 与主管只读） | 隔离 TestClient 抽检 | 403，`error_code=FORBIDDEN` | PASS |
| TC-09 | 缺 Token | GET / PATCH | 401 UNAUTHORIZED | 隔离 TestClient 抽检 | GET/PATCH 均为 401，`error_code=UNAUTHORIZED` | PASS |
| TC-10 | admin PATCH `2500.5` 后主管 GET | 同一隔离库 | 主管只读可见新值；测试库非业务库 | 隔离 TestClient 抽检 | GET `2500.5`；临时库存在且路径不等于运行时库 | PASS |

## 实际执行

```
.\.venv\Scripts\python.exe -m pytest backend/tests/test_workspace_settings.py --timeout=120 -v
```

- 退出码 0
- `collected 6 items`
- `======================= 6 passed, 45 warnings in 7.09s ========================`
- 仅跑该文件；未跑 `test_documents`、`test_tickets`、`test_prompt_templates`
- 警告来自 Starlette/Pydantic deprecation 与 pycore，不计入本任务 FAIL

抽检：隔离 TestClient，`FAILS=[]`，`EXTRA_CHECKS_PASS`。

## AC

本任务 `acceptanceCriteria=[]`。业务结果随 T-050。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-067～069、076～081 | 不在本任务判定 | 确认后分配、打标、列表与时效归 T-050 |
| 确认工单按金额升高风险 | 不在本任务判定 | `urgency_elevated_by_amount` 已提供且按未配置/已配置断言；工单确认路径尚未接入该函数，归 T-050 |

## 未验项

- 真实 8099 直播 HTTP（本轮为 technicalChecks，按派发不启、不杀 8099）
- 关闭 Mock 后的管理端设置页与工单确认金额打标（T-050）
- `workspace_settings` 表在运行时业务库中的存量行（测试只用隔离库；未改业务库）

## 范围外

- ORM 类 `WorkspaceSettings` 定义在 `backend/src/services/workspace_settings.py` 而非 `db/models.py`。write_scope 不含 `db/models.py`，派发要求不为分层改该文件；表仍挂在 `Base.metadata` 且隔离库可建表读写。不计入本任务 FAIL。
- pycore Pydantic v2 deprecation 警告，不计入 FAIL
