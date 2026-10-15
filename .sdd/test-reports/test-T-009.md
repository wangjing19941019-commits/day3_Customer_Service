# T-009 Tester 报告

- 任务：T-009 后端：员工发消息状态机与检索生成
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-003`（REQ-001）及 REQ-003 已转接等待路径
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-17
- 业务 AC 由 T-012（REQ-001）/ T-013（AC-005～AC-008，含 AC-006 已转接再问）真实验收，本轮不判这些 AC
- 未调用真实阿里云百炼 Chat/Embedding；全程 `set_llm_override(FakeLlm)` 或 handed_off 短路

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（3.13.15）
- 工作目录：`Projects_Repo/Customer_Service`（pytest `pythonpath` 含 `.` 与 `backend`）
- 派发：`sdd_dispatch.py` → `execution_mode=automatic`，`gate_phase=passed`（T-017），`tester_ready=["T-009"]`，exit 0
- 仓库指纹：Develop_Helper HEAD `ec75f8f113402be73a415282dd274a8e3513f291`；`Projects_Repo/Customer_Service/backend` 工作区相对该仓库干净
- 未占用/重启 Vite 5199、uvicorn 8099；本轮用 FastAPI TestClient + `tmp_path/test.db`
- 未触碰业务库 `backend/data/Customer_Service.db`（该路径本轮未出现业务库文件）
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec、experience.md

## 检查表

| ID | 场景/输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | `status=handed_off` 后 POST `/messages` | 员工发消息 | 不调 bailian；`kind=waiting_for_agent`；员工 `rewritten_content=null` | pytest `test_handed_off_does_not_call_bailian` | 200；`reply.kind=waiting_for_agent`；`status=handed_off`；chat/embed 调用均为 0；假客户端若被调用会 AssertionError | PASS |
| TC-01b | 已转接后连发第二条 | 同一会话再发 | 不重复刷 waiting 占位；reply 仍为等待含义 | 同上 | waiting 消息仍 1 条；第二条 reply 仍 `waiting_for_agent` | PASS |
| TC-01c | bot 会话连续 6 次强制 `needs_clarification` | 发 6 条含糊问 | 前 5 次 clarification；第 6 次为 **config** 兜底原文；round 归 0 | pytest `test_six_needs_clarification_then_config_fallback` | kinds=`clarification`×5 + `fallback`；前 5 次反问句一致；第 6 次 content=`这是配置里的兜底原文。`；rounds=`1..5` 后 `0`；无 embed | PASS |
| TC-02a | 两类对象分块，只问 hardware | 知识召回 | 先按对象标签过滤，禁止把另一类对象分块送进生成 | pytest `test_tag_filter_skips_other_object_chunks` + `test_filter_chunks_requires_object_tags` | 生成 prompt 含 hardware 分块、不含 account；无对象标签时过滤结果为空；`rank_chunks` 只对过滤后集合做余弦 | PASS |
| TC-02b | ingesting/failed/ready 三份相同 FAQ 向量 | FAQ 拦截 | 只命中 ready 文档 | pytest `test_faq_hits_only_ready_documents` | `kind=faq`，答案为「就绪 FAQ 答案」；无闲聊/知识生成调用。仓库 `list_ready_faqs`/`list_ready_chunks` 均 `ingest_status=="ready"` | PASS |
| TC-02c | 自定义 `fallback_reply` + qa.py 源码 | 满轮兜底 / 静态 | 兜底只从 config 读，代码不另写 PRD 原文 | pytest `test_six_...` + `test_fallback_reply_comes_from_config_only` | 第 6 次返回自定义 config 文案；`qa.py` 不含 PRD 兜底原文、不含 dashscope/plugin/「工单」 | PASS |
| TC-03a | 分类 JSON 缺 `rewritten_query` | 假客户端改写失败 | `rewritten=原问` 仍继续（本例 out_of_scope → fallback） | pytest `test_rewrite_missing_uses_original` | 员工 `original_content`/`rewritten_content` 均为「今天天气怎么样」；`kind=fallback` 用 config 原文 | PASS |
| TC-03b | 分类非 JSON | 假客户端分类失败 | 「服务暂时不可用，请稍后重试。」；不是超范围原文；保留员工原问 | pytest `test_classify_failure_is_502_keeps_employee` | HTTP 502，`INTERNAL_ERROR`，文案匹配；error ≠ 兜底原文；会话仅 1 条 `employee_turn` | PASS |
| TC-03c | Chat 抛 `BailianError(..., 429)` | 假客户端限流 | 按不可用，不把 429 当超范围 | pytest `test_rate_limit_is_unavailable_not_fallback` | 502，文案为暂时不可用 | PASS |
| TC-03d | Embedding 抛 `BailianError` | 假客户端嵌入失败（Tester 补跑） | 同上 502 暂时不可用，无 fallback 系统回复 | 复用 `FakeLlm.embed_error` 的 TestClient 一次性脚本 | 502，`INTERNAL_ERROR`，error ≠ 兜底原文；会话仅 `employee_turn`；无真实网。日志：`问答生成或嵌入失败` | PASS |
| TC-04 | API-010 成功体 | 对照 §二 | `data.conversation` + `data.reply`；`kind` / `original_content` / `rewritten_content` | pytest 多条 + Pydantic `MessagePublic` | 未转人工员工消息必有原问与改写；已转接新消息 `rewritten_content=null`；reply.kind 覆盖 waiting/clarification/faq/small_talk/knowledge/fallback | PASS |

补充（任务描述，非新需求，已抽检）：空内容 400、无会话 404、无 Bearer 401、闲聊不检索、多 issue 一条 `knowledge`、既有创建/转接/客服回复路由仍可用。`conversations.py` 含 `/messages`；T-008 范围内仍无 websocket/dashscope/`chat/completions`/`embeddings`（`test_routes_do_not_use_websocket_or_llm`）。

## 实际执行

```
python .../scripts/sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json
# exit 0；tester_ready=["T-009"]；gate_phase=passed（T-017）

.venv\Scripts\python.exe -m pytest backend/tests/test_qa.py backend/tests/test_conversations.py --timeout=120 -q
# 24 passed, 95 warnings in 27.12s
# exit_code: 0
```

- `test_qa.py`：15 passed（含 API-010 状态机、召回、失败降级）
- `test_conversations.py`：9 passed（含编排器改写后的 `/messages` 存在断言）
- 警告来自 pycore/Starlette/Pydantic 弃用，与 T-008 同类，不计入本任务 FAIL
- 嵌入失败补跑：临时库 + `FakeLlm`，未写入业务库、未改测试文件

## AC

本任务 `acceptanceCriteria=[]`。REQ-001 的 AC-001、AC-002、AC-011～AC-016、AC-019～AC-022 由 **T-012** 真实联调（须证明经过后端与百炼/向量，不能用 Mock）。REQ-003 的 AC-005～AC-008 由 **T-013** 验收。本轮只判定 technicalChecks，返回「PASS（后端阶段）」，不证明完整业务闭环。

## 未验项

- 真实百炼 Chat/Embedding（本任务明确禁止；Key 存在 ≠ 付费授权）
- 真实浏览器员工端发消息（T-012/T-013）；未把 Mock 前端当成本任务证据
- 直播 uvicorn `127.0.0.1:8099` 上的 curl（本轮以隔离 TestClient 为准，避免动已有服务）
- D-004 换题且已可处理后 `clarification_round` 立即重置：代码在非反问分支 `set_clarification_round(..., 0)`，无独立 pytest；T-012 technicalChecks 再验
- 仅文字提到「转人工」不改 `status`（AC-007）：属 T-013，本轮未单开用例
- 提示词与 `tag-taxonomy.json` 的 `classification_rules`/`query_output` 已对照文件存在且形状一致；真实模型是否遵守属 T-012

## 经验候选（仅核实，未落盘）

1. **异步 Session 读 messages 需 selectinload**
   - 本轮：`get_by_id` 仍 `selectinload(Conversation.messages)`；API-010 多条 pytest 返回 `conversation.messages` 未见 MissingGreenlet。
   - 根因未做去掉 selectinload 的负向对照。适用边界同 T-008。

2. **写子行后 expire 已加载集合再按 id 查询**
   - 证据：`add_message` 在 flush 后 `expire(conversation, ["messages", "updated_at"])`；`QaService._finish` / `_handed_off_turn` 用 `conversation_id` 再 `get_by_id`。
   - 本轮验证：handed_off 连发、六轮反问、FAQ/知识回复均能在响应中看到本轮员工消息与系统 reply。未做 expire 整对象后再读 `.id` 的负向对照。

## 范围外

- pycore / Starlette TestClient 弃用警告
- `MessageCreate` / `AgentReplyCreate` 将 4000 字上限写在 Pydantic 常量（与 §二一致，配置表无对应字段）；不计入本任务 FAIL
- 测试夹具 `chunk_overlap_chars=80` 与方案默认 160 不一致，仅测试 settings，未改生产配置
- 未开始 T-010/T-011 或其他任务
