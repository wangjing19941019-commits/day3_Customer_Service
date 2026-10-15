# T-023 Tester 报告

- 任务：T-023 后端：工单草稿、异步抽取与确认 API-013～015
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-005`（REQ-005、REQ-008）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-22
- 业务 AC-030～AC-034、AC-041、AC-043 由 T-026 真实验收，本轮不判
- Tester 未改业务代码、未改 `.sdd/tasks.json`、未 git commit、未绑定 8099、未跑 `test_documents.py`、未打印 `backend/.env`、未调用真实百炼

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（pytest 报告 Python 3.13.15）
- 工作目录：项目根 `Projects_Repo/Customer_Service`
- pytest 9.1.1；pytest-timeout 2.4.0；timeout method=thread
- 命令：`.venv\Scripts\python.exe -m pytest backend/tests/test_tickets.py backend/tests/test_conversations.py --timeout=120`
- 结果：collected 26；**26 passed**；139 warnings；35.61s
- 隔离库：pytest `tmp_path` + TestClient；未连 8099，未写业务库
- Fake LLM：`src.services.ticket.set_extract_llm_override`；**不作为真实抽取质量通过**
- `sdd_dispatch.py --running-task T-023`：exit 0；`execution_mode=automatic`；`gate_phase=frontend_in_progress`（T-021）；`tester_ready=["T-020"]`；`in_flight_or_queued` 含 T-023。本轮收尾已派发的 T-023 验收，不续派。T-023 为 backend，不是 integration/delivery，前端门禁不阻断本轮技术检查
- `specification=default`；rules 按任务清单加载
- 依赖 T-008、T-009 均为 passed
- 报告不写密钥；无 Key 路径用 `llm_api_key=""` 的隔离配置

## 检查表

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | handed_off 会话 GET API-013 | HTTP 200；可建 `status=draft`、`ticket_type=null`、`business_line=null`；GET 不调模型 | pytest `test_handed_off_get_creates_draft_without_llm`；`test_transfer_inserts_empty_ticket_without_changing_response` | GET 200，信封完整，`TicketPublic` 键齐全；draft/idle/`can_confirm=false`；二次 GET 同一 `id`。转接 API-011 响应无工单字段，SQLite 已有空草稿 | PASS |
| TC-01b | bot 会话 GET API-013 | HTTP 409 CONFLICT「会话尚未转人工，不能填单」 | pytest `test_bot_session_ticket_is_409` | 409，`error_code=CONFLICT`，文案一致 | PASS |
| TC-01c | 未选类型 POST confirm | 409「请先选择售后工单类型」 | pytest `test_confirm_without_type_or_line_is_409` | 仅转接后 confirm 409 该文案；工单仍 draft | PASS |
| TC-01d | 已选类型、未选业务线 POST confirm | 409「请先选择业务线」 | 同上 | PATCH 仅 `ticket_type=return_exchange` 后 confirm 409 该文案 | PASS |
| TC-01e | 确认后 PATCH `ticket_type` | 409「工单已确认，不能更改工单类型」；PATCH 字段/业务线 200 | pytest `test_confirm_then_patch_type_409_fields_and_line_ok` | 确认 200 `status=confirmed`；改类型 409 CONFLICT；改 `business_line` 200；改 `intent_summary` 200 且 `agent_edited` | PASS |
| TC-02a | 改类型后抽取 | PATCH 立即 `extract_status=extracting`；GET 不调模型 | pytest `test_patch_type_extracts_in_background_and_get_skips_model`；读 `tickets.py` GET 无 `run_extract_job` | PATCH 200 + extracting；随后 GET `ready`、amount=99 extracted；GET 前后 `chat_calls` 不变。GET 路由只 `get_or_create` | PASS |
| TC-02b | 后说金额 99→88；手改不被覆盖 | 后说覆盖 `extracted`/`incomplete`；`agent_edited` 保持 | pytest `test_later_amount_overwrites_extracted_not_agent_edited` | 先 99 extracted；「改成 88 元」后 88 extracted；手改 80 后新消息仍 80 / agent_edited | PASS |
| TC-02c | 确认后再发新消息 | 不投递抽取；金额保持确认值 | pytest `test_confirm_then_new_message_does_not_extract` | 确认后 POST API-010 200，响应无工单字段；`chat_calls` 不变；GET 仍 confirmed、amount=99 | PASS |
| TC-02d | extracting 超时 | 按 `ingest_stale_seconds` 标 failed；字段保持 | pytest `test_stale_extracting_marked_failed_keeps_fields`；读 `fail_stale_extracting_tickets` | 将 `updated_at` 改为 2000-01-01 后 GET：`failed` +「抽取暂时失败，请稍后重试或手填」；amount 仍 80、status=draft。cutoff 用 `settings.ingest_stale_seconds`（测试配置 300） | PASS |
| TC-02e | 金额须能在会话原文找到 | 模型给出会话没有的值 → incomplete | pytest `test_ungrounded_amount_is_incomplete` | Fake 填 12345、会话无该金额 → value=null、status=incomplete | PASS |
| TC-03a | 抽取提示词 | 仅 `ticket/extract_*.md` 与 `line_*.md`；禁止 Plugin/OMS | pytest `test_extract_prompts_have_no_plugin_or_oms`；读 `_build_extract_prompt`；列目录 | 目录仅 7 个目标文件；拼接只用 extract_common + 类型 extract + 可选 line；文件与系统提示均无 plugin/oms/dashscope。`ticket.py`/`tickets.py` 无 Plugin/OMS | PASS |
| TC-03b | 无 Key 手填确认 | 抽取 failed；手填后 confirm 仍 200 | pytest `test_no_key_hand_fill_confirm_still_200` | `llm_api_key=""`：选类型后 GET `extract_status=failed`；手填投诉字段后 confirm 200 confirmed | PASS |
| TC-03c | 响应信封 | 对照 §二 TicketPublic + 统一信封 | pytest `_assert_envelope` / `_assert_public`（多条成功/失败用例） | 成功：`success/data/error/error_code/message/timestamp/request_id/metadata`；`data` 恰为 12 个 TicketPublic 键。失败同信封且 `data=null` | PASS |
| TC-03d | 真实百炼抽取质量 | 本任务不要求 live Bailian；Fake LLM 不得当真实通过 | 未启动 8099、未读 `.env`、未发 dashscope | Fake 只覆盖本地合并/接地/后台任务语义。抽取质量与 AC-030～032 留给 T-026 | 不判 PASS（非本任务必要项） |

## 实际执行

```
python harness-core/../scripts/sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-023
# exit 0；execution_mode=automatic；gate_phase=frontend_in_progress (T-021)

.venv\Scripts\python.exe -m pytest backend/tests/test_tickets.py backend/tests/test_conversations.py --timeout=120
# collected 26 items
# backend/tests/test_tickets.py ................          [ 61%]
# backend/tests/test_conversations.py ..........          [100%]
# 26 passed, 139 warnings in 35.61s
# 警告来自 Starlette TestClient / Pydantic datetime.utcnow，不计入本任务
```

未绑定 8099。未跑 `backend/tests/test_documents.py`。未打印 `backend/.env`。

相关用例：

- `test_tickets.py`（16）：`test_get_ticket_requires_bearer`、`test_bot_session_ticket_is_409`、`test_missing_conversation_is_404`、`test_handed_off_get_creates_draft_without_llm`、`test_confirm_without_type_or_line_is_409`、`test_patch_type_extracts_in_background_and_get_skips_model`、`test_later_amount_overwrites_extracted_not_agent_edited`、`test_confirm_then_patch_type_409_fields_and_line_ok`、`test_confirm_then_new_message_does_not_extract`、`test_ungrounded_amount_is_incomplete`、`test_switch_type_changes_visible_keys`、`test_patch_unknown_field_key_is_400`、`test_vat_special_without_tax_id_cannot_confirm`、`test_stale_extracting_marked_failed_keeps_fields`、`test_no_key_hand_fill_confirm_still_200`、`test_extract_prompts_have_no_plugin_or_oms`
- `test_conversations.py`（10）：含 `test_transfer_inserts_empty_ticket_without_changing_response` 及既有转接/列表回归

## AC

本任务 `acceptanceCriteria=[]`。关联 AC-030～034、AC-041、AC-043 的后端契约由本轮 technicalChecks 覆盖；客服端填单确认由 T-026 关闭 Mock 后用真实 API 与页面验收。本轮不开始业务联调，不把后端阶段 PASS 写成完整业务通过。

## 经验核对

本轮派发未附经验候选。Tester 不写经验库。

## 未验项

- 真实百炼抽取质量与后说覆盖的现场效果（T-026；Fake LLM 仅验本地 API）
- 真实浏览器客服端填单（T-026）
- 8099 现役进程上的 HTTP（派发禁止绑定 8099）
- `test_qa.py` / `test_documents.py`（派发禁止）
- API-016/017（T-024）

## 范围外

- 另一智能体仍在改 `backend/src/models/document.py` 与 `backend/tests/test_documents.py`，未触碰
- `test_qa.py` 17 passed 为 Developer 自述，本轮未复跑，不计入判定
- `polish.md` 属 T-024 写范围，本轮 `prompts/ticket/` 仅有 extract_* 与 line_* 七个文件
- dispatch 显示 T-020 亦在 in_flight，不在本轮验收范围
