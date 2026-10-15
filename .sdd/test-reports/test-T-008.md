# T-008 Tester 报告

- 任务：T-008 后端：会话创建、转人工与客服回复
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-004`（REQ-003）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-13
- 业务 AC-005～AC-008 由 T-013 真实验收，本轮不判这些 AC
- 未实现 API-010（约定由 T-009）

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（3.13.15）
- 工作目录：`Projects_Repo/Customer_Service`（pytest `pythonpath` 含 `.` 与 `backend`）
- pytest-timeout：2.4.0 已就位；命令带 `--timeout=120`
- 未占用 8099：并行 T-007 在途，本轮用 TestClient 隔离库，不启动 uvicorn
- 测试库：`tmp_path/test.db`，未触碰业务库 `backend/data/`
- 未改业务代码、`.sdd/tasks.json`、PRD、experience.md；未改 T-002/T-003/T-004/T-007 文件

## 检查表

| ID | 场景/输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 已登录 POST `/api/conversations` | 创建会话 | HTTP 200，`status=bot`，空 messages | pytest `test_create_conversation_status_bot` | 200，`status=bot`，`waiting_for_agent=false`，`clarification_round=0`，`messages=[]` | PASS |
| TC-01b | 仅 bot 会话 GET `/api/conversations` | API-008 列表 | 不返回 bot | pytest `test_list_does_not_return_bot_until_transfer` | 创建后 id 不在列表；全部 `status=handed_off` | PASS |
| TC-01c | 转人工后再 GET 列表 | API-011 后列表 | 已转接会话可见，未转接仍不可见 | 同上 | 转接后目标 id 出现；另一 bot id 仍不出现；`waiting_for_agent=true` | PASS |
| TC-01d | 详情含员工消息 | API-009 | messages 含 `original_content` / `rewritten_content` 形状 | 同上（测试库插入 employee_turn） | 两字段均存在；原问/改写分别为「VPN 连不上」/「VPN 连接失败排查」 | PASS |
| TC-02a | bot 会话 POST `/replies` | API-012 | 409，文案「会话尚未转人工，无法以客服身份回复」 | pytest `test_untransferred_agent_reply_is_409` | 409，`error_code=CONFLICT`，文案一致；会话仍 `bot`、无消息 | PASS |
| TC-02b | 不存在的会话 | 详情 / 客服回复 | 404 `NOT_FOUND`「会话不存在」 | `test_detail_missing_conversation_is_404`、`test_reply_missing_conversation_is_404` | 两路均为 404 / `NOT_FOUND` /「会话不存在」 | PASS |
| TC-02c | 无 Bearer | 创建/列表/详情/转人工/回复 | 均 401 | `test_create_conversation_requires_bearer`、`test_conversation_endpoints_require_bearer` | 全部 401，`error_code=UNAUTHORIZED` | PASS |
| TC-03a | T-008 写范围内代码 | 静态+测试 | 不引入 WebSocket；不调用 LLM | grep 写范围文件 + `test_routes_do_not_use_websocket_or_llm` | 无 websocket/dashscope/`chat/completions`/bailian；路由无 `/messages` | PASS |
| TC-03b | 转接后客服回复 | API-012 成功路径 | 200，`reply.role/kind=agent`，写入同一会话 | `test_agent_reply_after_transfer` | 200；幂等二次转接仍 `handed_off`；列表 preview 为回复正文 | PASS |

补充（任务描述，非新需求）：API-007～009/011/012 已实现；API-010 未做。

## 实际执行

```
python -m pip show pytest-timeout
# Name: pytest-timeout  Version: 2.4.0

python -m ruff check backend/src/models/conversation.py backend/src/repositories/conversation_repository.py backend/src/services/handoff.py backend/src/api/routes/conversations.py backend/tests/test_conversations.py
# All checks passed

python -m pytest backend/tests/test_conversations.py backend/tests/test_sessions.py --timeout=120 -q
# 16 passed, 54 warnings in 17.66s
```

回归 `test_sessions.py` 7 项仍绿，确认本轮会话路由未破坏登录夹具。警告来自 pycore/Starlette/Pydantic 弃用，不计入本任务 FAIL。

## AC

本任务 `acceptanceCriteria=[]`。F-004 / REQ-003 的 AC-005、AC-006、AC-007、AC-008 由 T-013 做真实联调（含页面与 API-010 已转接等待路径），本轮不判。

## 未验项

- 真实浏览器员工端/客服端闭环（T-013）
- API-010 员工发消息、FAQ/AI 与「仅文字转人工不改状态」（T-009 / T-013）
- 直播 uvicorn 8099（避免与在途 T-007 抢端口；本轮以 TestClient 为准）
- API-011 缺会话 404 无独立用例；与 API-009/012 同走 `ConversationNotFoundError`，未单开负向对照

## 经验候选（仅核实，未落盘）

1. **异步 Session 读 messages 需 selectinload**
   - 证据：`Conversation.messages` 为默认 lazy；`get_by_id` 使用 `selectinload(Conversation.messages)`；`create` / `mark_handed_off` 在 flush 后按 id 再 `get_by_id`。
   - 本轮验证：创建后访问 `messages=[]`、转接后组装 `waiting_for_agent` 的 pytest 通过，未见 MissingGreenlet。
   - 根因：SQLAlchemy 异步 Session 懒加载会 MissingGreenlet。本轮验证的是修复路径，未故意去掉 selectinload 做负向复现。
   - 适用：SQLAlchemy 2 异步 + 同一请求内序列化 `conversation.messages`。
   - 建议编排器沉淀。

2. **已加载集合上 selectinload 不刷新；expire 集合后再按 id 读取**
   - 证据：`add_message` 只 `expire(conversation, ["messages", "updated_at"])`；`agent_reply` 用入参 `conversation_id` 再 `get_by_id`，不在 expire 整对象后读 `.id`。
   - 本轮验证：`test_agent_reply_after_transfer` 断言 `conversation.messages[-1].id == reply.id`，通过。
   - 根因：同一 Session identity map 下已加载 relationship 不会因再次 selectinload 自动刷新。未做「expire 整对象后再读 `.id`」的负向对照。
   - 适用：同 Session 内 `add` 子行后再返回带集合的父对象。T-009 写消息时同样适用。
   - 建议编排器沉淀。

## 范围外

- pycore / Starlette TestClient 弃用警告（与 T-006 同类）
- 并行任务 documents/ingest/bailian 未读取、未改动
