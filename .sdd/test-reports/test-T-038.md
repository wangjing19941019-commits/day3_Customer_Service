# T-038 Tester 报告

- 任务：T-038 后端：工单四态六类契约、增量抽取与 EXT-003/007
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-005`（REQ-005）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 业务 AC-030～034、AC-041、AC-043～047、AC-057、AC-058、AC-083、AC-085 由 T-026 / T-046 真实验收；分配由 T-042；本任务不把假 LLM 客户端或进程内 Mock 适配器当作真实百炼 / 订单中心 / 物流联调

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15，满足 3.11+）
- pytest 9.1.1 + pytest-timeout 2.4.0（会话日志 `timeout: 120.0s` 已生效）
- 工作目录：`Projects_Repo/Customer_Service`
- `PYTHONPATH=.`；只跑 `backend/tests/test_tickets.py` 与 `backend/tests/test_ticket_extract.py`
- 未启动、未重启、未杀 8099；未跑 `test_documents.py` / `test_prompt_templates.py` / `test_workspace_settings.py`
- 未改 `backend/src/db/session.py`、业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git
- 抽取用 `FakeExtractLlm` 覆盖；订单/物流用 `MockOrderAdapter` / `MockLogisticsAdapter` 覆盖或空地址工厂 Mock
- 测试库：各用例 `tmp_path` 下隔离 SQLite（`test.db` / `extract.db`），未 `drop_all` 运行时库
- 运行后业务库 `backend/data/Customer_Service.db` 仍存在，大小仍为 622592 字节
- 配置：测试占位 `llm_api_key` 为 `placeholder-llm-key` 或空串；报告不写密钥、Token
- 本轮指纹（sha256 前 12 位）：
  - `tickets.py` 路由 `f6a19d964cdf`
  - `services/ticket.py` `ba642949c27e`
  - `models/ticket.py` `9fb90eaef446`
  - `ticket_repository.py` `c03d4f051af1`
  - `adapters/order.py` `fd9a3079e858`
  - `adapters/logistics.py` `2df7afd6bf22`
  - `test_tickets.py` `428cfa7e74a9`
  - `test_ticket_extract.py` `5d982b55bdd4`

调度：`execution_mode=automatic`；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`（T-035）、`tester_ready` 含 `T-038`。本任务为 backend technicalChecks，不是 integration/delivery。依赖 T-023 / T-036 已 passed，本轮不重验。

context_files 章节均存在：PRD「REQ-005…」、tech-spec API-013/014/015、EXT-003～007、工单字段、增量抽取（D-006=B，D-008）、API-013～015 算法与失败表、decisions D-008 / D-009。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 已转人工、尚无工单行 | GET API-013 | 200 空草稿；不调模型或适配器 | pytest `test_handed_off_get_creates_draft_without_llm_or_adapters` | `status=draft`，`ticket_no=null`，`ticket_type/business_line=null`，公共四键均为 `missing`；LLM/订单/物流调用次数不变 | PASS |
| TC-01b | `status=bot` 未转人工 | GET API-013 | 409「会话尚未转人工，不能填单」 | pytest `test_bot_session_ticket_is_409` | HTTP 409，`error_code=CONFLICT`，文案一致 | PASS |
| TC-01c | 未选六类 / 仅选类型未选业务线 | POST API-015 | 409「请先选择售后工单类型」/「请先选择业务线」 | pytest `test_confirm_without_type_or_line_is_409` | 先 409 类型文案；PATCH 类型后确认 409 业务线文案；仍为 draft | PASS |
| TC-01d | 已选退换货+业务线但必填缺失 | POST confirm | 409 且指出字段 | pytest `test_missing_required_fields_block_confirm` | 409，`metadata.confirm_blockers` 非空，`error` 含 blocker 键 | PASS |
| TC-01e | 金额低置信 candidate | POST confirm | 409 挡住并指出 `amount` | pytest `test_low_confidence_is_candidate_and_blocks_confirm` | `amount.status=candidate`，`value=null`，候选含 99；confirm 409 且 blockers 含 `amount` | PASS |
| TC-01f | 金额 99 后再抽 88 为 conflict | POST confirm | 409 挡住并指出 `amount` | pytest `test_later_high_confidence_amount_keeps_original_and_marks_conflict` | 仍 99 + `conflict` + `conflict_value=88`；confirm 409 | PASS |
| TC-01g | 确认后改类型 | PATCH `ticket_type` | 409「工单已确认，不能更改工单类型」 | pytest `test_confirm_then_patch_type_409_fields_and_line_ok` | 409 CONFLICT，该文案；业务线/字段仍可 PATCH 200 | PASS |
| TC-02a | D-008：99 后再抽 88 | 两轮抽取 | 仍为 99 + conflict，不覆盖 | 同上 | 与预期一致；旧「后说覆盖」未出现 | PASS |
| TC-02b | 坐席手改金额 80 后再说 88 | 抽取合并 | `agent_edited` 值不被覆盖 | pytest `test_agent_edited_is_not_overwritten` | 值仍 80；与 88 矛盾后标 `conflict`，`conflict_value=88` | PASS |
| TC-02c | EXT-003 一条 | 后台匹配 | 订单号 `filled`，`order_match.status=auto_filled` | pytest `test_ext003_one_hit_auto_fills_order_no` | 填入 `JD20260922001`；`time_range` 为原话「昨天」 | PASS（进程内 Mock） |
| TC-02d | EXT-003 两条 | 后台匹配 | 不预选，两条都列出 | pytest `test_ext003_two_hits_are_candidates_without_preselect` | `value=null`，`status=candidate`，候选 `JD-A`/`JD-B`；confirm 409 含 `order_no` | PASS（进程内 Mock） |
| TC-02e | EXT-003 零条 / 失败 | 后台匹配 | `missing` +「暂未查到」，不编造单号 | pytest `test_ext003_zero_hits_missing_with_message`、`test_ext003_failure_missing_with_message` | 零条 `order_match.status=missing`；失败 `query_failed`；`query_message=暂未查到`；`order_no.value=null` | PASS（进程内 Mock） |
| TC-02f | 轨迹失败 | 抽取后 PATCH 责任方/补偿 | 字段保持 missing；PATCH 409 | pytest `test_logistics_track_failed_blocks_responsible_party_patch` | 即使假 LLM 给出责任方/补偿，抽取后仍 `missing`；PATCH 409「物流轨迹暂未核实，不能填写责任方或补偿方案」 | PASS（进程内 Mock） |
| TC-02g | GET 永不调模型或适配器 | GET 两次 | 调用次数不增加 | pytest `test_get_does_not_call_adapters`、`test_patch_type_extracts_in_background_and_get_skips_model` | PATCH 后 GET 的 LLM/订单调用次数与 GET 前相同 | PASS |
| TC-03a | 空 `order_center_base_url` / `logistics_base_url` | 工厂选择 | 进程内 Mock，不走 HTTP、不编造外部凭证 | 代码 + 一次性工厂探测 | `AppSettings` 无这两字段；`getattr(..., "")` 空串 → `MockOrderAdapter` / `MockLogisticsAdapter`。`.env.example` 两键为空。探测：空命名空间得到 Mock；显式 URL 才是 Http*（本轮未配、未打真实服务） | PASS（Mock） |
| TC-03b | 无百炼 Key | 手填后确认 | 仍 200；不把假客户端当真实抽取 | pytest `test_no_key_hand_fill_confirm_still_200` | `llm_api_key=""`，覆盖 LLM=None；抽取 `failed` 后手填投诉字段确认 200，`status=pending` 且有 `ticket_no` | PASS |

补充（任务描述，非新需求；未计入新 AC）：

| 项 | 结果 |
| --- | --- |
| 确认成功只落到 `pending` + `ticket_no`，不分配 | `test_confirm_then_patch_type_409_fields_and_line_ok`：`status=pending`，`ticket_no` 以 `TKT-` 开头；`urgency`/`queue`/`assigned_role` 均为 null。分配归 T-042 |
| 确认幂等 | 再 POST confirm 仍 200，同一 id / ticket_no / pending |
| 确认后再发消息不抽取 | `test_confirm_then_new_message_does_not_extract`：LLM 调用次数不变，金额仍为确认值 |
| 费用争议无截图 409 | `test_fee_dispute_without_attachment_cannot_confirm`：409「费用争议需要证据截图」，blockers 含 `attachments`。上传接口仍归 T-040 |
| 专票无税号 409 | `test_vat_special_without_tax_id_cannot_confirm`：409「专用发票需要纳税人识别号」；补税号后 200 |
| 六类字段键切换 | `test_switch_type_changes_visible_keys`：退换货 / 发票 / 费用争议 / 物流异常键集与 §三一致 |
| 金额不在原文 → missing | `test_ungrounded_amount_is_missing` |
| 抽取超时失败保留字段 | `test_stale_extracting_marked_failed_keeps_fields`：`extract_status=failed`，文案「抽取暂时失败，请稍后重试或手填」，金额 80 保留 |
| 提示词无 Plugin/OMS/dashscope | `test_extract_prompts_have_no_plugin_or_oms` |
| GET 不调适配器；轨迹成功才允许手填责任方 | `test_logistics_track_ok_allows_agent_fill`：抽取不自动填责任方；轨迹 `ok` 后 PATCH 200 为 `agent_edited` |
| HTTP 客户端 | `httpx.AsyncClient(trust_env=False)`；无 `dashscope`、无 `os.environ`/`os.getenv` 读业务配置 |
| TicketPublic 信封 | 测试断言公开字段与 API-013 示例键一致；成功 `success/data/error/error_code/message` |

## 实际执行

```
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe -m pytest backend/tests/test_tickets.py backend/tests/test_ticket_extract.py --timeout=120 -v
```

- 退出码 0
- `collected 27 items`
- `====================== 27 passed, 193 warnings in 31.20s ======================`
- 警告来自 Starlette/Pydantic/`datetime.utcnow` 与 pycore，不计入本任务 FAIL
- 断言为 `assert` 失败即非 0，不是只打印布尔值
- 未重跑全量 `backend/tests`

关键用例（本任务 technicalChecks 直接覆盖）：

- `test_handed_off_get_creates_draft_without_llm_or_adapters`
- `test_bot_session_ticket_is_409`
- `test_confirm_without_type_or_line_is_409`
- `test_missing_required_fields_block_confirm`
- `test_low_confidence_is_candidate_and_blocks_confirm`
- `test_later_high_confidence_amount_keeps_original_and_marks_conflict`
- `test_confirm_then_patch_type_409_fields_and_line_ok`
- `test_agent_edited_is_not_overwritten`
- `test_ext003_one_hit_auto_fills_order_no`
- `test_ext003_two_hits_are_candidates_without_preselect`
- `test_ext003_zero_hits_missing_with_message`
- `test_ext003_failure_missing_with_message`
- `test_logistics_track_failed_blocks_responsible_party_patch`
- `test_get_does_not_call_adapters`
- `test_no_key_hand_fill_confirm_still_200`

空地址工厂（测试夹具之外，无 override）：无 URL 属性时 `get_order_adapter` / `get_logistics_adapter` 返回 Mock；本轮未对真实订单中心/物流发 HTTP。

## AC

本任务 `acceptanceCriteria=[]`。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-030～034、AC-041、AC-043 | 不在本任务判定 | T-026 真实 API + 浏览器 |
| AC-044、AC-045、AC-046、AC-047、AC-057、AC-058、AC-083、AC-085 | 不在本任务判定 | T-046 真实页面与适配器路径 |
| 分配 / SLA / 认领 | 不在本任务判定 | T-042 / T-050 / T-051 |

本地 pytest 已覆盖与上述 AC 对应的接口契约、四态合并、EXT-003/007 Mock 行为与确认 409，但不能代替关闭前端 Mock 后的真实百炼抽取或真实订单中心/物流。

## 范围外

- 运行时 `backend/.env` 目前没有 `order_center_base_url` / `logistics_base_url` 键（`.env.example` 有且为空）。`AppSettings` 也未声明这两字段；空/缺失均走进程内 Mock，符合本任务「空地址 Mock、不要为 URL 改 session.py」。HTTP 适配器要等配置字段进入 AppSettings 后才会启用，真实凭证本轮没有，归 T-046。
- 未验真实百炼 Chat、真实订单中心、真实物流轨迹。
- 未验确认后自动分配、紧急程度、EXT-004/005 联动。
- 未用浏览器做填单面板。
- 未杀、未复用 8099 做 HTTP 冒烟。

## 结论

T-038 全部 technicalChecks 已用隔离 pytest 验证通过。总结果 **PASS（后端阶段）**。本 PASS 不等于 T-026/T-046 业务 AC 通过，也不等于用户已放行前端门禁。
