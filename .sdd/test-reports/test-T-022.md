# T-022 Tester 报告

- 任务：T-022 后端：电商标签 v2.0 同步与改写分类/入库打标
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-003`（REQ-001）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-22
- 业务 AC 由 **T-025** 真实验收，本轮不判 AC-001 / AC-012～016 / AC-019 / AC-021
- 未调用真实阿里云百炼 Chat/Embedding；pytest 全程 `set_llm_override(FakeLlm)`。假客户端 **不是** 真实百炼通过。

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15；pytest-9.1.1；timeout 120s thread）
- 工作目录：`C:/Users/慈海客服/Desktop/demo/Develop_Helper/Projects_Repo/Customer_Service`
- 派发：`harness-core` 脚本 `sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-022`
  - `execution_mode=automatic`；`step_phase=not_applicable`
  - `gate_phase=frontend_in_progress`（T-021）；本任务为 backend，已在途验收，非 integration/delivery，继续收尾
  - `in_flight_or_queued` 含 T-022；未自行续派 T-020 / T-023
- 依赖：T-007、T-009 均为 `passed`
- 仓库指纹：Develop_Helper HEAD `ec75f8f113402be73a415282dd274a8e3513f291`。Customer_Service 嵌套 git 无 commit；本轮以工作区文件内容与 SHA 为准
- 标签副本 SHA-256（docs 与 backend 相同）：`985c9b6ecf17fb3032766ca40fb0ce80d3ce202e00e96e7c29d90ecee1d7b85e`
- 未启动/占用 uvicorn 8099；用 FastAPI TestClient + `tmp_path` SQLite
- 未读取、未打印 `backend/.env`
- 未跑 `backend/tests/test_tickets.py`、`backend/tests/test_conversations.py`
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec

## 检查表

| ID | 场景/输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | `backend/src/resources/tag-taxonomy.json` | 读 `version` / `object_types.code` | `version=2.0`；含 `product_3c`/`product_fashion` 等 v2.0；不含 `hardware`/`software`/`account` | 读文件 + Python JSON/SHA + pytest `test_backend_taxonomy_is_v2_and_same_as_docs` | `version` 为 `"2.0"`；codes=`product_3c, product_fashion, order_logistics, return_exchange, address_change, invoice, complaint`；v1 交集为空 | PASS |
| TC-01b | `docs/tag-taxonomy.json` vs backend 副本 | 字节与 JSON 比对 | 同源 | SHA-256 与 `json.loads` 相等；pytest `docs == backend` | 字节相等、JSON 相等、同一 SHA-256 | PASS |
| TC-01c | `EntityTag.type` | 读模型 | `product` \| `order` \| `spec` | 读 `backend/src/models/document.py` | `type: Literal["product", "order", "spec"]`；ingest/qa `_ENTITY_TYPES` 同集；非法 `device`/`resource` 被丢弃（`test_ingest_drops_illegal_v1_codes`） | PASS |
| TC-02a | `ingest_tag_faq.md`、`rewrite_classify.md` | 对照 v2.0 `classification_rules` | 3C/服饰不混用；未转人工不建单、不查实时订单物流库存支付 | 读提示词 + pytest `test_prompts_write_v2_classification_rules` | 两文件含规则同义句；禁止 v1 code；`small_talk.md`/`answer.md` 已去掉企业内部 IT 口径并写电商约束 | PASS |
| TC-02b | 3C 问题 + 仅服饰分块 | 对象标签过滤 | 禁止 3C 问题命中仅服饰块 | pytest `test_tag_filter_skips_other_object_chunks`、`test_filter_chunks_requires_object_tags` | 生成 prompt 含「耳机保修两年…」/`chunk-3c`，不含「连衣裙七天无理由…」/`chunk-fashion`；`related` 含 `product_fashion` 时仍只返回 3C 块（`_is_cross_category_chunk`） | PASS |
| TC-02c | bot 会话发消息 | 查 tickets | 不插入 tickets | pytest `test_bot_turn_does_not_insert_tickets` | `status=bot`；`kind=fallback`；`tickets` 行数 0；无 embed | PASS |
| TC-03a | `fallback_reply` | 源码与自定义 config | 只从 config 读 | pytest `test_fallback_reply_comes_from_config_only`；读 `qa.py` / `AppSettings` | `qa.py` 三处兜底均为 `self.settings.fallback_reply`；不含 PRD 原文、dashscope、plugin、「工单」。默认值在 `AppSettings.fallback_reply` | PASS |
| TC-03b | `requires_live_data` / `out_of_scope` | 自定义兜底文案 | 同一固定兜底原文；不调工具 | pytest `test_live_data_and_out_of_scope_use_same_config_fallback` | 两次 `kind=fallback` 且 content=`这是配置里的兜底原文。`；`embed_calls=[]`；无非 JSON 生成调用 | PASS |
| TC-03c | 无分块映射 | ready 但无可用分块 | 同一 config 兜底 | 读 `qa.py` `_processable_turn`：`knowledge_segments` 为空则走同一 `self.settings.fallback_reply`（与 live/out_of_scope 同出口） | 无独立 HTTP 用例名，但出口与 TC-03b 相同（约 479–482 行）。`filter_chunks_for_issue` 无对象标签返回 `[]` | PASS |
| TC-03d | 无真实 Key / FakeLlm | 本地单测 | 不阻塞；不把假客户端当真实百炼 | 本轮 pytest 37 passed，未启动 8099、未打真实百炼 | `FakeLlm` 内存覆写；`llm_api_key` 仅为测试占位名。**不判定 EXT-001/002 真实通过** | PASS |

## 实际执行

```
.venv\Scripts\python.exe -m pytest backend/tests/test_qa.py backend/tests/test_taxonomy.py backend/tests/test_documents.py --timeout=120
```

- collected 37 items
- `backend/tests/test_qa.py` 17 passed
- `backend/tests/test_taxonomy.py` 4 passed
- `backend/tests/test_documents.py` 16 passed
- **37 passed**, 129 warnings, **48.62s**, exit_code **0**
- 警告来自 Starlette TestClient / Pydantic / `datetime.utcnow` 弃用，不计入本任务 FAIL

附加静态核对（非 pytest 命令）：

- `docs/tag-taxonomy.json` `version`=`2.0`
- `backend/src/resources/tag-taxonomy.json` `version`=`2.0`，与 docs 字节级相同
- `EntityTag.type = Literal["product", "order", "spec"]`

## AC

本任务 `acceptanceCriteria=[]`。REQ-001 本轮变更 AC（AC-001、AC-012～016、AC-019、AC-021，及与兜底绑定的 AC-015）由 **T-025** 在前端门禁通过、关闭 Mock、真实 API-010 + 已 ready 电商标签知识后验收。本轮只判定 technicalChecks，返回「PASS（后端阶段）」，不证明完整业务闭环，也不证明真实百炼。

## 未验项

- 真实百炼 Chat/Embedding（本任务明确：无 Key 不阻塞本地单测；假客户端≠真实通过）
- 真实浏览器员工端问答（T-025）
- 直播 uvicorn `127.0.0.1:8099` 上的 curl（编排器禁止本轮启动 8099）
- `test_tickets.py` / `test_conversations.py`（编排器指定他测占用，本轮禁止）
- 无分块映射缺少独立 HTTP pytest 名称；行为由 `_processable_turn` 空 `knowledge_segments` 与 TC-03b 同出口覆盖
- 模型是否在真实调用中遵守提示词：属 T-025

## 经验候选

本轮未收到 Developer 经验候选，无核对项。

## 范围外

- T-021 前端门禁仍 `frontend_in_progress`：不阻塞本 backend 技术验收，但不等于用户已放行 Mock
- T-023 工单 API、T-020 前端工单页：他测/他开发范围
- pycore / Starlette / Pydantic 弃用警告
- `test_documents.py` 里仍有实体名「VPN」作 `type=product` 的夹具，属测试数据，不引入 v1 `device`/`resource`
