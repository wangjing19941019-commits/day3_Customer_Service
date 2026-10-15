# T-024 Tester 报告

- 任务：T-024 后端：坐席知识推送 API-016 与润色预览 API-017
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-005`（REQ-006、REQ-007、REQ-008）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-22
- 业务 AC-035～AC-040、AC-042、AC-043 由 T-027 真实验收，本轮不判
- Tester 未改业务代码、未改 `.sdd/tasks.json`、未 git commit、未绑定 8099、未启动/结束 Vite、未打印 `backend/.env`、未调用真实百炼

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（pytest 报告 Python 3.13.15）
- 工作目录：项目根 `Projects_Repo/Customer_Service`
- pytest 9.1.1；pytest-timeout 2.4.0；timeout method=thread；timeout=120s
- 命令：`.venv\Scripts\python.exe -m pytest backend/tests/test_agent_knowledge.py backend/tests/test_polish.py --timeout=120`
- 结果：collected 18；**18 passed**；99 warnings；15.32s
- 隔离库：pytest `tmp_path` + FastAPI TestClient；未连 8099，未写业务库
- Fake LLM：`set_knowledge_llm_override` / `set_polish_llm_override`；**不作为真实百炼召回/润色质量通过**
- `sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-024 --running-task T-021`：exit 0；`execution_mode=automatic`；`step_phase=not_applicable`；`gate_phase=frontend_in_progress`（T-021）；`tester_ready=[]`；`in_flight_or_queued` 含 T-021、T-024。本轮收尾已派发的 T-024 验收，不续派。T-024 为 backend，不是 integration/delivery，前端门禁不阻断本轮技术检查
- `specification=default`；rules 按任务清单加载（backend/tech-stack、layers、api-design、error-handling、workflow；shared/naming、env-policy、security）
- 依赖 T-022、T-023 均为 passed
- 项目目录 git 无 HEAD（`main` 尚无 commit）；本轮指纹用 SHA256 前 12 位：
  - `9cde96eb7157` `backend/src/services/agent_knowledge.py`
  - `985e70b649b7` `backend/src/services/polish.py`
  - `ba0183a3467c` `backend/src/api/routes/conversations.py`
  - `ab4140784f0e` `backend/src/prompts/ticket/polish.md`
  - `a35c1bda5988` `backend/tests/test_agent_knowledge.py`
  - `195b46fdc716` `backend/tests/test_polish.py`
  - `f3860936e523` `backend/.env.example`
  - `19538f2bb705` `backend/src/db/session.py`
- 报告不写密钥；无 Key 路径用隔离配置 `llm_api_key=""`；未读取 `backend/.env`

## 检查表

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | handed_off GET API-016 空库 | HTTP 200；`suggestions=[]`；`empty_message` 固定「当前没有可推送的政策或流程」；不插入 `messages` | pytest `test_handed_off_empty_library_does_not_write_messages`；读 `AgentKnowledgeService.suggest` | 200 信封完整；`data` 恰为 KnowledgeSuggestionPublic 7 键；`suggestions=[]`；`empty_message` 与常量原文一致；GET 前后 message id 相同；空库不调 embeddings | PASS |
| TC-01b | bot 会话 GET API-016 | HTTP 409 CONFLICT | pytest `test_bot_session_knowledge_is_409` | 409，`error_code=CONFLICT`；会话仍 `status=bot`，`messages=[]` | PASS |
| TC-01c | 改 business_line 后下一次 016 | 3C 保修块不得作为服饰退货当前依据 | pytest `test_business_line_switch_changes_knowledge_scope` | 先 PATCH `digital_3c`：命中 `doc-3c` / 质保年限，不含 `doc-fashion` /「七天无理由」。再 PATCH `apparel_beauty`：命中服饰七天无理由，不含 `doc-3c`。二次 GET 不写 messages。item 无 embedding | PASS |
| TC-01d | 无 Key 且有分块 | 016 502「服务暂时不可用，请稍后重试。」随后 API-012 仍能发原稿 | pytest `test_no_key_with_chunks_is_502_then_api012_still_sends` | 502 `INTERNAL_ERROR` + 固定原文；messages 未增；POST `/replies` 200，`reply.content` 为原稿、`role=agent` | PASS |
| TC-01e | 嵌入失败 | 502，不得编造政策 | pytest `test_embed_failure_is_502_not_fabricated_policy` | Fake 抛 `BailianError` → 502 同上文案；错误正文不含「时限」 | PASS |
| TC-02a | POST API-017 预览 | 200；`original_content`/`polished_content`；不写 messages、不调 API-012 | pytest `test_polish_preview_does_not_write_or_send`；读 `polish_agent_reply` 与 `PolishService.polish` | 200；`data` 恰两键；原稿回显；messages 快照不变。路由只调 `polish()`，不调 `agent_reply()`。Fake Chat `json_object=False`；系统提示含 polish.md 禁令与 3C line 片段，不含服饰专属口径 | PASS |
| TC-02b | content 空白 | 400「请输入回复内容」 | pytest `test_polish_empty_content_is_400` | 400 `VALIDATION_ERROR`，文案一致 | PASS |
| TC-02c | bot 会话 POST API-017 | 409「会话尚未转人工」 | pytest `test_bot_session_polish_is_409` | 409 CONFLICT，文案一致；会话仍 bot、无消息 | PASS |
| TC-02d | Chat 失败后 API-012 | 502「服务暂时不可用，请稍后重试。」随后 012 发原稿 | pytest `test_chat_failure_is_502_then_api012_sends_original` | 502 `INTERNAL_ERROR` + 固定原文；messages 未变；POST `/replies` 200，`content` 为原稿，`role=agent`，`kind=agent` | PASS |
| TC-02e | 无 Key 润色 | 同 502，012 仍可发 | pytest `test_no_key_polish_is_502_then_api012_still_sends` | 502 固定原文；012 200 原稿 | PASS |
| TC-02f | 模型空输出 | 502 同上文案，不冒充润色稿 | pytest `test_empty_model_output_is_502` | Fake 返回空白 → 502 固定原文 | PASS |
| TC-03a | `agent_knowledge_top_k` 默认 3 | config 默认 3；召回用该字段 | pytest `test_agent_knowledge_top_k_defaults_to_three`；读 `AppSettings` 与 `rank_chunks(..., self.settings.agent_knowledge_top_k, ...)` | `AppSettings.agent_knowledge_top_k: int = 3`；未写入 dict 时 `model_validate` 得 3；`.env.example` 有 `agent_knowledge_top_k=3` | PASS |
| TC-03b | `.env.example` | 仅占位，不含真实密钥 | pytest `test_env_example_has_placeholder_top_k`；读 example（未读 `.env`） | `llm_api_key=your-llm-api-key`；文中无 `sk-`；`secret_key`/`shared_password` 为 `change-me`；新增 top_k 占位 | PASS |
| TC-03c | 禁止润色自动发送 | 017 不写库、不发消息；发出只走 012 的 content | pytest TC-02a/d/e；读 `PolishService.polish` 只返回 `AgentPolishPublic` | 服务无 `add_message` / `agent_reply`；预览后员工侧无新消息；012 仍发请求体 `content` | PASS |
| TC-03d | 禁止 OMS | 016/017 实现与 polish.md 无 OMS/Plugin | 定向 grep write_scope：`agent_knowledge.py`、`polish.py`、`polish.md`、`conversations.py` 知识/润色路由 | 无 OMS/oms/Plugin 命中。polish.md 禁止查询订单/物流/库存/支付、禁止调用工具或外部系统 | PASS |
| TC-03e | 真实百炼 | 本任务不要求 live Bailian；Fake 不得当真实通过 | 未启动 8099、未读 `.env`、未发 dashscope | Fake 只覆盖本地 409/400/502/空态/口径过滤/不写 messages。召回与润色质量留给 T-027 | 不判 PASS（非本任务必要项） |

## 实际执行

```
python scripts/sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-024 --running-task T-021
# exit 0；execution_mode=automatic；gate_phase=frontend_in_progress (T-021)
# tester_ready=[]；in_flight_or_queued=["T-021","T-024"]

.venv\Scripts\python.exe -m pytest backend/tests/test_agent_knowledge.py backend/tests/test_polish.py --timeout=120
# collected 18 items
# backend/tests/test_agent_knowledge.py .........          [ 50%]
# backend/tests/test_polish.py .........                   [100%]
# 18 passed, 99 warnings in 15.32s
# 警告来自 Starlette TestClient / Pydantic datetime.utcnow，不计入本任务
```

未绑定 8099。未启动或结束 Vite（5206 上另一 Tester 的前端会话未触碰）。未跑 `test_conversations.py` / `test_tickets.py`（派发仅指定上述 18 条）。未打印 `backend/.env`。

相关用例：

- `test_agent_knowledge.py`（9）：`test_agent_knowledge_top_k_defaults_to_three`、`test_env_example_has_placeholder_top_k`、`test_knowledge_requires_bearer`、`test_bot_session_knowledge_is_409`、`test_missing_conversation_knowledge_is_404`、`test_handed_off_empty_library_does_not_write_messages`、`test_business_line_switch_changes_knowledge_scope`、`test_no_key_with_chunks_is_502_then_api012_still_sends`、`test_embed_failure_is_502_not_fabricated_policy`
- `test_polish.py`（9）：`test_polish_prompt_forbids_new_promises`、`test_polish_requires_bearer`、`test_polish_empty_content_is_400`、`test_bot_session_polish_is_409`、`test_polish_preview_does_not_write_or_send`、`test_unlocked_line_does_not_use_exclusive_tone`、`test_chat_failure_is_502_then_api012_sends_original`、`test_no_key_polish_is_502_then_api012_still_sends`、`test_empty_model_output_is_502`

契约对照（只读）：

- GET `/api/conversations/{id}/knowledge-suggestions`：handed_off 200；空结果固定 empty_message；不写 messages；bot 409；嵌入失败/无 Key 502 固定原文
- POST `/api/conversations/{id}/replies/polish`：200 仅 `original_content`/`polished_content`；空白 400；未转人工 409；Chat 失败/空输出/无 Key 502 固定原文；不写 messages
- POST `/api/conversations/{id}/replies` 在 016/017 失败后仍可发送请求体 `content`
- `KnowledgeSuggestionPublic` / `KnowledgeSuggestionItem` / `AgentPolishPublic` 字段与 §三一致；item 不含 embedding
- `AppSettings.agent_knowledge_top_k` 默认 3，召回 `rank_chunks` 使用该配置而非字面量 3
- Config 读取 `use_env=False`；example 仅占位

## AC

本任务 `acceptanceCriteria=[]`。关联 AC-035～040、AC-042、AC-043 的后端契约由本轮 technicalChecks 覆盖；客服端知识区、润色后确认发出、未选类型仍可润色发送由 T-027 关闭 Mock 后用真实 API 与页面验收。本轮不开始业务联调，不把后端阶段 PASS 写成完整业务通过。

## 经验核对

本轮派发未附经验候选。Tester 不写经验库。

## 未验项

- 真实百炼嵌入召回质量、润色稿是否新增赔付/改价/「一定全额退」（T-027；Fake LLM 仅验本地 API 与提示词约束）
- 真实浏览器客服端知识区 / 润色后发送（T-027）
- 8099 现役进程上的 HTTP（派发禁止绑定 8099）
- `test_conversations.py` / `test_tickets.py` 回归（Developer 声称 26 passed；本轮按派发只跑 18 条）
- 前端不得 3 秒轮询 API-016（T-021 / T-027，非本后端任务）

## 范围外

- T-021 前端 Mock 门禁仍 `frontend_in_progress`，本轮未验收页面
- API-013～015 工单抽取（T-023 已 PASS）
- 未转人工问答 / 电商标签（T-022 / T-025）
