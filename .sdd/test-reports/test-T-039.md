# T-039 Tester 报告

- 任务：T-039 后端：坐席知识溯源、合规润色 `can_adopt` 与模板选用
- 类型：`backend`；`acceptanceCriteria=[]`；`source_feature=F-005`（REQ-006、REQ-007、REQ-008）
- 总结果：**PASS（后端 technicalChecks）**
- 时间：2026-09-23
- 业务 AC-035～AC-040、AC-042、AC-043 由 T-027 真实验收；AC-048～AC-052、AC-062 由 T-047 真实验收。本轮不判真实百炼。
- Tester 未改业务代码、未改 `.sdd/tasks.json`、未 Git 写操作、未杀 8099、未改 `ticket.py`、未跑 `test_assign.py` / `test_sla.py` / `test_ticket_queue.py`、未打印 `backend/.env`、未调用真实百炼。

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- 工作目录：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- pytest 9.1.1；pytest-timeout 2.4.0；timeout method=thread；timeout=120s
- 命令：`.venv\Scripts\python.exe -m pytest backend/tests/test_agent_knowledge.py backend/tests/test_polish.py --timeout=120 -v`
- 结果：collected 23；**23 passed**；135 warnings；18.56s；exit 0
- 隔离库：pytest `tmp_path` + FastAPI TestClient；未连 8099，未写业务库
- Fake LLM：`set_knowledge_llm_override` / `set_polish_llm_override` / `set_extract_llm_override`；**不作为真实百炼召回/润色质量通过**
- 无 Key 路径：`client_no_key` 将 `llm_api_key=""` 且 **不** 注入 Fake LLM，走真实 502 分支
- `sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-039`：exit 0；`execution_mode=automatic`；`step_phase=not_applicable`；`gate_phase=frontend_in_progress`（T-035）；`tester_ready=[]`；`in_flight_or_queued` 含 T-035、T-039、T-042。本轮收尾已派发的 T-039，不续派。T-039 为 backend，不是 integration/delivery。
- `specification=default`；rules 按任务清单加载（backend/tech-stack、layers、api-design、error-handling、workflow；shared/naming、env-policy、security）
- 依赖 T-024、T-037、T-038 均为 `passed`
- 项目目录 git 无 HEAD（`main` 尚无 commit）；本轮指纹用 SHA256 前 16 位 + 修改时间：
  - `A7A1DAA9E9778BB5` `backend/src/api/routes/conversations.py` 7019B 2026-09-23 08:41:10
  - `59EDD12CEC45B8C3` `backend/src/services/agent_knowledge.py` 13195B 2026-09-23 08:40:35
  - `43BFD0940C45CF32` `backend/src/services/polish.py` 13306B 2026-09-23 08:43:23
  - `AF52A62E058B4439` `backend/src/prompts/ticket/polish.md` 1244B 2026-09-23 08:41:05
  - `7FFE9E0CA2957E2F` `backend/tests/test_agent_knowledge.py` 22496B 2026-09-23 08:42:33
  - `02D177B96DBAF358` `backend/tests/test_polish.py` 15699B 2026-09-23 08:42:33
- 报告不写密钥；无 Key 路径用隔离配置 `llm_api_key=""`；未读取 `backend/.env`

## 检查表

T-039 `acceptanceCriteria=[]`，按 `technicalChecks` 编号为 TC-01 / TC-02。预期来自任务描述、API-016/017、D-010、§六 502 约定。

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | handed_off GET API-016 空库 | HTTP 200；`suggestions=[]`；`empty_message` 固定「当前没有可推送的政策或流程」；不插入 `messages` | pytest `test_handed_off_empty_library_does_not_write_messages`；对照 `AgentKnowledgeService.suggest` 空库直接 `_empty_result` | 200 信封完整；`data` 恰为 KnowledgeSuggestionPublic 7 键；`suggestions=[]`；`empty_message` 与常量原文一致；GET 前后 message id 相同；空库不调 embeddings | PASS |
| TC-01b | 过期政策 + 未填生效时间 + 现行政策同库 | 过期/未填日期的政策不作为当前依据；只出现现行篇 | pytest `test_expired_policy_is_not_current_basis`；对照 `retrieve.is_current_basis` + `load_ready_chunks(..., AUDIENCE_AGENT)` | `doc-current` 在结果；`doc-expired`、`doc-undated` 不在结果；每条 `_assert_item_shape` | PASS |
| TC-01c | 业务线 3C → 服饰 | 3C/服饰口径不混用 | pytest `test_business_line_switch_changes_knowledge_scope` | 先 PATCH `digital_3c`：命中 `doc-3c`，不含 `doc-fashion`，`applicable_category=3C数码`。再 PATCH `apparel_beauty`：命中服饰七天无理由，不含 `doc-3c`，`applicable_category=服饰美妆`。二次 GET 不写 messages | PASS |
| TC-01d | Query `q=退货流程` 搜索 | 与推送同一结果形状：`main_answer`/`summary`/`source`/`effective_from`/`effective_to`/`applicable_category`/`visibility` | pytest `test_search_query_returns_same_provenance_fields`；对照 `_build_query` 有 `search_q` 时只用 q | 200；embed 最后一次输入为 `["退货流程"]`；不含 `doc-3c`；可含服饰或仅坐席步骤；每条字段齐全；`visibility` 落在坐席三者；不写 messages | PASS |
| TC-01e | bot 会话 GET API-016 | HTTP 409 CONFLICT | pytest `test_bot_session_knowledge_is_409` | 409，`error_code=CONFLICT`；会话仍 `status=bot`，`messages=[]` | PASS |
| TC-02a | POST API-017 预览 | 200；含 `original_content`/`polished_content`/`compliance_passed`/`can_adopt`/`risk_reasons`；不写 `messages` | pytest `test_polish_preview_does_not_write_or_send` | 200；`data` 恰五键；原稿回显；`compliance_passed=true`、`can_adopt=true`、`risk_reasons=[]`；messages 快照不变。系统提示含 polish.md 禁令与 3C 口径，不含服饰专属 | PASS |
| TC-02b | Fake 润色稿新增「一定全额退」+ 赔付额 | HTTP 200 且 `can_adopt=false`；不写 messages | pytest `test_noncompliant_polish_is_200_but_cannot_adopt`；`test_compliance_rejects_new_payout_and_keeps_existing_deadline`；对照 `can_adopt=passed` | 200；`compliance_passed=false`；`can_adopt=false`；`risk_reasons` 含赔付金额或退款保证；messages 未变。规则函数对合法时效稿 `passed=True` | PASS |
| TC-02c | bot 会话 POST API-017 | 409 未转人工 | pytest `test_bot_session_polish_is_409` | 409 CONFLICT，「会话尚未转人工」；会话仍 bot、无消息 | PASS |
| TC-02d | 无 Key 且有分块 / 无 Key 润色 | 016/017 均 502「服务暂时不可用，请稍后重试。」随后 API-012 仍能发原稿 | pytest `test_no_key_with_chunks_is_502_then_api012_still_sends`；`test_no_key_polish_is_502_then_api012_still_sends`（均无 Fake LLM） | 016 与 017 均 502 `INTERNAL_ERROR` + 固定原文；POST `/replies` 200，`reply.content` 为原稿、`role=agent` | PASS |
| TC-02e | Chat / 嵌入失败后 012 | 502 后原稿仍可 API-012 | pytest `test_chat_failure_is_502_then_api012_sends_original`；`test_embed_failure_is_502_not_fabricated_policy` | 502 固定原文；016 错误正文不含「时限」；012 200 原稿 `kind=agent` | PASS |

附加定向核对（支撑 technicalChecks，不新增需求）：

| ID | 核对 | 实际 | 结果 |
| --- | --- | --- | --- |
| AUX-01 | 每条知识项字段与 API-016 契约 | `_ITEM_KEYS` 含 `main_answer`/`summary`/`source`/`effective_from`/`effective_to`/`applicable_category`/`visibility`；Pydantic `KnowledgeSuggestionItem` 同名字段；`source` 为 `filename / heading_path` | PASS |
| AUX-02 | 坐席可含仅坐席可见 | 搜索用例插入 `visibility=agent_only` 的 `after_sale_howto` 块；`visibilities <= {user_visible, agent_only, high_risk_human_only}` | PASS |
| AUX-03 | 016/017 不写 messages | `agent_knowledge.py` / `polish.py` 无 `add_message` / `agent_reply`；路由只调 `suggest()` / `polish()` | PASS |
| AUX-04 | 模板选用：无类型售前、物流行程中、退货售后 | `_template_scene`：无类型 → `pre_sale`；`logistics_exception` 未签收 → `in_transit`；其余有类型 → `after_sale`。`test_return_template_is_selected_for_published_after_sale` 断言渲染后无 `{{emotion}}` 且含用户情绪或售后说明。`test_unlocked_line_does_not_use_exclusive_tone` 未锁定业务线不加 3C/服饰专属 | PASS（本地规则；真实售前口径归 T-047 AC-052） |
| AUX-05 | polish.md 禁令 | `test_polish_prompt_forbids_new_promises`：含一定全额退/赔付/改价/退款/愤怒/时效 | PASS |
| AUX-06 | `agent_knowledge_top_k` 默认 3；`.env.example` 仅占位 | `test_agent_knowledge_top_k_defaults_to_three`；`test_env_example_has_placeholder_top_k`：`llm_api_key=your-llm-api-key`，文中无 `sk-` | PASS |
| AUX-07 | 真实百炼 | 未启动 8099、未读 `.env`、未发 dashscope。Fake 不算真实通过 | 不判 PASS（归 T-027/T-047） |

## 实际执行

```
python scripts/sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-039
# exit 0；execution_mode=automatic；gate_phase=frontend_in_progress (T-035)
# tester_ready=[]；in_flight_or_queued=["T-035","T-039","T-042"]

.venv\Scripts\python.exe -m pytest backend/tests/test_agent_knowledge.py backend/tests/test_polish.py --timeout=120 -v
# collected 23 items
# backend/tests/test_agent_knowledge.py ...........   [ 47%]
# backend/tests/test_polish.py ............           [100%]
# 23 passed, 135 warnings in 18.56s
# 警告来自 Starlette TestClient / Pydantic datetime.utcnow，不计入本任务
```

未绑定、未启动、未结束 8099。未跑 `test_assign.py` / `test_sla.py` / `test_ticket_queue.py`。未改 `ticket.py`。未触碰 Vite 5175/5288。

用例清单：

- `test_agent_knowledge.py`（11）：`test_agent_knowledge_top_k_defaults_to_three`、`test_env_example_has_placeholder_top_k`、`test_knowledge_requires_bearer`、`test_bot_session_knowledge_is_409`、`test_missing_conversation_knowledge_is_404`、`test_handed_off_empty_library_does_not_write_messages`、`test_business_line_switch_changes_knowledge_scope`、`test_expired_policy_is_not_current_basis`、`test_search_query_returns_same_provenance_fields`、`test_no_key_with_chunks_is_502_then_api012_still_sends`、`test_embed_failure_is_502_not_fabricated_policy`
- `test_polish.py`（12）：`test_polish_prompt_forbids_new_promises`、`test_compliance_rejects_new_payout_and_keeps_existing_deadline`、`test_polish_requires_bearer`、`test_polish_empty_content_is_400`、`test_bot_session_polish_is_409`、`test_polish_preview_does_not_write_or_send`、`test_unlocked_line_does_not_use_exclusive_tone`、`test_return_template_is_selected_for_published_after_sale`、`test_noncompliant_polish_is_200_but_cannot_adopt`、`test_chat_failure_is_502_then_api012_sends_original`、`test_no_key_polish_is_502_then_api012_still_sends`、`test_empty_model_output_is_502`

契约对照（只读）：

- GET `/api/conversations/{id}/knowledge-suggestions`：handed_off 200；空结果固定 empty_message；不写 messages；bot 409；过期/未填生效时间的政策不出现；3C 与服饰不混用；`q` 搜索字段与推送一致；嵌入失败/无 Key 502 固定原文
- POST `/api/conversations/{id}/replies/polish`：200 含合规字段；不合规仍 200 且 `can_adopt=false`；空白 400；未转人工 409；Chat 失败/空输出/无 Key 502 固定原文；不写 messages
- POST `/api/conversations/{id}/replies` 在 016/017 失败后仍可发送请求体 `content`
- HTTP 502 + `error_code=INTERNAL_ERROR` + 「服务暂时不可用，请稍后重试。」对齐 tech-spec §六，不是 4xx

## 逐 AC

T-039 `acceptanceCriteria=[]`，无本任务业务 AC 可判。关联 AC 归属：

- T-027（pending，integration）：AC-035、AC-036、AC-037、AC-038、AC-039、AC-040、AC-042、AC-043
- T-047（pending，integration）：AC-048、AC-049、AC-050、AC-051、AC-052、AC-062

本轮不把上述 AC 标 PASS。

## 范围外

- 真实百炼 Chat/Embedding 质量与浏览器闭环：T-027 / T-047
- T-042 分配/SLA/队列：未跑对应测试，未改 `ticket.py`
- 前端门禁 T-035：`gate_phase=frontend_in_progress`；本 Tester 只收尾已在途的 T-039
- Starlette/Pydantic deprecation 警告：存量框架，不计入判定

## 结论

**PASS**。当前任务全部 technicalChecks 已用隔离 pytest 验证通过。假 LLM 仅覆盖本地契约路径；真实召回/润色质量与客服端可见结果归 T-027/T-047。
