# T-016 Tester 报告

- 任务：T-016 后端：API-004 可选 ingest_status 过滤与非法 400
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-002`（REQ-002）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-14
- 业务 AC-027 / AC-028 由 T-011 在真实页面验收，本轮不判
- Tester 未改业务代码、`tasks.json`、PRD、技术方案；未杀 8099 uvicorn；未调用百炼

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（3.13.15）
- 工作目录：项目根 `Projects_Repo/Customer_Service`
- `PYTHONPATH`：`pyproject.toml` `pythonpath = [".", "backend"]`
- pytest-timeout 2.4.0；命令带 `--timeout=120`
- 隔离库：pytest `tmp_path` + 一次性 TestClient 临时库；未连 8099
- 业务库 `backend/data/Customer_Service.db` 仍为 53248 bytes，mtime 2026-09-12 17:33:41
- `sdd_dispatch.py`：`execution_mode=automatic`，`gate_phase=frontend_in_progress`，`tester_ready` 含 T-016；依赖 T-007=`passed`
- 报告不写密钥/token

## 检查表

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | 三篇不同 `ingest_status`、不同 `updated_at`；不传 `ingest_status` | 全部返回且 `updated_at` 降序；`pagination.total_items` 为全集条数 | pytest `test_list_documents_filter_sort_and_pagination` + 独立 TestClient 三篇 | 不传：ids=`doc-ingesting, doc-ready, doc-failed`（更新时间 17:03:11 > 17:03:01 > 17:02:51）；`total_items=3`。pytest 四篇：`doc-ready-new, doc-ingesting, doc-ready-old, doc-failed`，`total_items=4` | PASS |
| TC-01b | `ingest_status=ingesting` | 只含 ingesting，仍降序；`total_items` 为过滤后条数 | 同上 | ids=`doc-ingesting`；status 全为 ingesting；`total_items=1` | PASS |
| TC-01c | `ingest_status=ready` | 只含 ready，仍降序；过滤后分页 total | pytest 两篇 ready、`page_size=1` | page1=`doc-ready-new`，page2=`doc-ready-old`；`total_items=2`，`total_pages=2`，`has_next=true`；独立探测一篇 ready 亦只含该状态 | PASS |
| TC-01d | `ingest_status=failed` | 只含 failed；`total_items` 过滤后 | 同上 | ids=`doc-failed`；`total_items=1` | PASS |
| TC-02a | `unknown` / 空串 `ingest_status=` / `Ready` | HTTP 400；`error`「入库状态筛选无效」；`error_code=VALIDATION_ERROR`；`data` 非列表 | pytest `test_list_documents_invalid_ingest_status_is_400` + 独立 TestClient | 三例均为 400；`error_code=VALIDATION_ERROR`；`data=null`（非 list）；pytest 断言文案为「入库状态筛选无效」 | PASS |
| TC-02b | `page=0` | 既有分页 400，`VALIDATION_ERROR` | 同上 | 400，`error_code=VALIDATION_ERROR`，`data=null` | PASS |
| TC-02c | 成功列表项字段 | 仍为既有 `DocumentListItem`，无新增键、无 `chunks` | pytest `set(item)==_LIST_ITEM_KEYS` + 独立探测 | 项键：id/filename/ingest_status/ingest_error/object_types/request_types/faq_count/chunk_count/created_at/updated_at；`extra_item_keys=[]`；信封无新增键 | PASS |
| TC-03a | 不改 `frontend/` | 本任务 write_scope 仅 backend 四文件 | 对照 write_scope 与 mtime | 写范围为 `documents.py` 模型/仓库/路由 + `test_documents.py`（00:55–00:58）。`db/models.py` 未改（09-13 23:59）。frontend 同期改动属并行 T-015 Mock，不计入本任务 | PASS |
| TC-03b | 不调用 bailian | 列表过滤不走入库/Embedding | 读 `list_documents`；探测用空 Key 隔离库 | `list_documents` 只解析 Query + `list_page`；未启动入库流水线；无百炼 HTTP | PASS |
| TC-03c | ruff / mypy 仅本任务写入的 backend 文件 | 通过 | 定向四文件 | ruff All checks passed；mypy Success: 4 source files | PASS |

## 实际执行

```
python -m pytest backend/tests/test_documents.py --timeout=120 -v
# 13 passed, 58 warnings in 17.11s（警告来自 pycore/Starlette/Pydantic，不计入本任务）

python -m ruff check backend/src/models/document.py backend/src/repositories/document_repository.py backend/src/api/routes/documents.py backend/tests/test_documents.py
# All checks passed

python -m mypy backend/src/models/document.py backend/src/repositories/document_repository.py backend/src/api/routes/documents.py backend/tests/test_documents.py
# Success: no issues found in 4 source files
```

独立 TestClient（临时 SQLite，不连 8099）抽检：

- 不传：200，三篇降序，`total_items=3`
- ingesting / ready / failed：各 1 条、状态匹配、`total_items=1`
- unknown / `ingest_status=` / Ready：400，`VALIDATION_ERROR`，`data=null`
- `page=0`：400，`VALIDATION_ERROR`

## AC

本任务 `acceptanceCriteria=[]`。关联 AC-027、AC-028 的服务端契约由本轮 technicalChecks 覆盖；页面筛选、空态文案、上传后切「全部」由 T-011 在关闭 Mock 后用真实 API-004 验收。本轮不开始联调。

## 未验项

- 真实浏览器知识库四档筛选与空态（T-011 / 待 T-015 Mock 完成）
- 真实百炼入库至 ready 后的列表过滤（无付费授权；本任务不要求）
- 8099 已有 uvicorn 进程上的 HTTP（按派发要求用隔离 TestClient）

## 范围外

- frontend `useDocuments.ts` / `documentService.ts` 等 mtime 约 00:59–01:00，与并行 T-015 知识库 Mock 一致，不是 T-016 write_scope
- `docs/tech-spec.md`「传输与校验」写「空字符串按缺值处理」，API-004 专节与本任务 TC 将 Query 空串视为非法筛选。实测空串 400，与 TC / §二失败示例 / §六一致，不因此 FAIL
