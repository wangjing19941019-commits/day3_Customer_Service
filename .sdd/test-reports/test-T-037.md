# T-037 Tester 报告

- 任务：T-037 后端：文档可见范围、生效时间与用户侧召回过滤
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-002`（REQ-002）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 业务 AC-053 / AC-059 / AC-060 由 T-045 真实验收；本任务不把假客户端或本地过滤当作真实百炼召回

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15，满足 3.11+）
- pytest 9.1.1 + pytest-timeout 2.4.0（会话日志 `timeout: 120.0s` 已生效）
- 工作目录：`Projects_Repo/Customer_Service`
- `PYTHONPATH=.`；只跑 `backend/tests/test_documents.py` 与 `backend/tests/test_retrieve.py`
- 未启动或重启 8099，未杀 8099；未跑 `test_tickets.py` / `test_prompt_templates.py` / `test_workspace_settings.py`
- 未调用百炼；入库就绪路径用 `_fake_tag` / `_fake_embed`；召回过滤用内存对象与隔离 SQLite，不把假客户端当真实召回
- 测试库：各用例 `tmp_path/test.db`，未清空或改写运行时业务库
- 配置：测试用占位 `llm_api_key=""` 或非真实 `test-key-not-real`；报告不写密钥、Token
- 未改业务代码、`backend/src/db/models.py`、`backend/src/db/session.py`、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git

调度：`execution_mode=automatic`；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`（T-035）、`tester_ready=["T-037"]`。本任务为 backend technicalChecks，不是 integration/delivery。依赖 T-007 / T-022 / T-036 不在本轮重验。

context_files 章节均存在：PRD「REQ-002…」、tech-spec API-005/006、共用召回（D-010）、API-003～006、decisions D-010。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | ready 文档 PATCH `visibility` + `effective_from`/`effective_to` 后 GET；再把时间置 null | API-006 → API-005 | PATCH 200 与随后 GET 字段一致；清空后两次时间均为 null，可见范围保留 | pytest `test_patch_visibility_and_effective_dates_then_get_matches` | 入库后默认 `user_visible`、时间为 null；PATCH `agent_only` + 2026-03-01～2026-12-31 后 GET 一致；再 PATCH 两时间为 null，GET 仍为 null，`visibility` 仍为 `agent_only` | PASS |
| TC-01b | 非法可见范围 / 结束早于开始 | PATCH | 400 `VALIDATION_ERROR`；文案「可见范围不合法」「结束时间不能早于开始时间」 | pytest `test_patch_invalid_visibility_or_date_range_is_400` | `visibility=public` → 400「可见范围不合法」；起止倒置 → 400「结束时间不能早于开始时间」 | PASS |
| TC-02 | 仅坐席 / 高风险 / 用户可见文档 | 未转人工召回 vs 坐席召回 | 用户侧只要 `user_visible`；`agent_only` 与 `high_risk_human_only` 不进入；坐席三者都可 | pytest `test_user_audience_excludes_agent_only_and_high_risk`、`test_load_ready_chunks_filters_visibility_and_policy_dates` | `allowed_for_audience(..., AUDIENCE_USER)`：agent_only/high_risk=False，user_visible=True；AUDIENCE_AGENT 前两者 True。`load_ready_chunks`：用户侧含 `user-ok`/`policy-ok`，不含 `agent-only`；坐席侧含 `agent-only` | PASS |
| TC-03 | 政策类缺日期或过期 | 当前依据与用户侧召回 | `policy_process`/`after_sale_howto` 缺日期或过期不作为当前依据，不进用户召回；区间内政策可进 | pytest `test_policy_missing_or_expired_dates_not_current_basis`、`test_load_ready_chunks_filters_visibility_and_policy_dates` | 缺两端日期、缺结束、过期 → `is_current_basis` False；有效区间 True；非政策 `usage_guidance` True。用户侧不含 `policy-missing`，含 `policy-ok`；坐席侧也不含缺日期政策 | PASS |
| TC-04 | ready 且未写可见范围的旧行 | GET 详情 / 列表 / 召回准入 | 默认 `user_visible`，避免旧文档从用户侧消失；入库中不默认 | pytest `test_old_ready_document_defaults_to_user_visible`、`test_ready_document_without_visibility_defaults_user_visible`、`test_list_documents_filter_sort_and_pagination` | GET `doc-ready-new` → `visibility=user_visible`、时间为 null。列表 ready 项 `user_visible`，ingesting 项 `visibility` 为 null。`visibility=None` 且 ready 的文档用户侧 `allowed_for_audience` True；ingesting False | PASS |
| TC-05 | 无百炼 Key | 本地过滤单测 | 不阻塞；不把假客户端当真实召回 | `client_no_key`（`llm_api_key=""`）；`test_fusion_score_uses_config_weights_not_a_live_client`；`test_load_ready_chunks_filters_visibility_and_policy_dates` | 无 Key 过滤与列表/默认可见范围均通过。融合分 `0.7*cosine+0.3*keyword` 来自 config，无 HTTP 客户端。入库假 embed 仅用于构造 ready 文档，未声称真实召回 | PASS |

补充（任务描述，非新需求；未计入新 AC）：

| 项 | 结果 |
| --- | --- |
| qa 改用共用召回，未转人工只要用户可见 | `qa.py`：`load_ready_faqs(..., AUDIENCE_USER)`、`load_ready_chunks(..., AUDIENCE_USER)` + `rank_retrieved_chunks` |
| 标签互斥仍生效 | `test_filter_chunks_still_blocks_cross_category` PASS（3C 问题不含服饰块） |
| 不引入 dashscope SDK | `test_no_dashscope_sdk_in_write_scope` PASS |
| 契约字段 | `DocumentPublic`/`DocumentListItem`/`DocumentUpdate` 含 `visibility`、`effective_from`、`effective_to`；权重 `AppSettings.retrieve_cosine_weight=0.7`、`retrieve_keyword_weight=0.3` |

## 实际执行

```
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe -m pytest backend/tests/test_documents.py backend/tests/test_retrieve.py --timeout=120 -v
```

- 退出码 0
- `collected 25 items`
- `====================== 25 passed, 101 warnings in 19.66s ======================`
- 警告来自 Starlette/Pydantic deprecation 与 pycore，不计入本任务 FAIL
- 断言为 `assert` 失败即非 0，不是只打印布尔值
- 未重跑全量 `backend/tests`（T-038 等可能在写其他后端文件）

关键用例（本任务 technicalChecks 直接覆盖）：

- `test_patch_visibility_and_effective_dates_then_get_matches`
- `test_patch_invalid_visibility_or_date_range_is_400`
- `test_old_ready_document_defaults_to_user_visible`
- `test_user_audience_excludes_agent_only_and_high_risk`
- `test_ready_document_without_visibility_defaults_user_visible`
- `test_policy_missing_or_expired_dates_not_current_basis`
- `test_load_ready_chunks_filters_visibility_and_policy_dates`
- `test_fusion_score_uses_config_weights_not_a_live_client`

## AC

本任务 `acceptanceCriteria=[]`。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-053 | 不在本任务判定 | 保存生效时间、离开再打开、清空后为空 → T-045 真实 API + 浏览器 |
| AC-059 | 不在本任务判定 | 仅坐席可见 vs 用户可见的员工提问/坐席推送对照 → T-045 真实召回 |
| AC-060 | 不在本任务判定 | 高风险仅人工不进入未转人工自动回答 → T-045 |

本地已覆盖与上述 AC 对应的接口字段与过滤逻辑，但不能代替关闭 Mock 后的真实百炼召回。

## 未验项

- 真实 8099 直播 HTTP（派发要求本轮 technicalChecks，不启/不杀 8099）
- 真实百炼 Embedding/Chat 召回与员工端回答文案（T-045）
- 关闭 Mock 后的知识库页保存/再打开（T-045）
- 坐席推送 API-016 对三类可见范围的端到端（T-039/T-047）

## 范围外

- pycore / Starlette Pydantic v2 deprecation 警告，不计入 FAIL
- T-038 工单契约、T-039 坐席推送不在本轮命令内
- 未收到经验候选；Tester 不写经验库

## 判定

当前任务全部 technicalChecks 已验证通过；业务 AC 已标明后续责任任务。总结果 **PASS**。
