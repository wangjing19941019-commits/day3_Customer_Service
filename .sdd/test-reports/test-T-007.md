# T-007 Tester 报告

- 任务：T-007 后端：知识上传、后台入库、分块与标签/FAQ
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-002`（REQ-002）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-13
- 业务 AC-003 / AC-004 / AC-017 / AC-018 / AC-023 / AC-024 由 T-011 真实验收，本轮不判
- Tester 未改业务代码、`tasks.json`、PRD、`experience.md`、`main.py`、conversations、T-005 前端文件

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（3.13.15）
- 工作目录：`Projects_Repo/Customer_Service`（项目根）
- `PYTHONPATH`：项目根 + `backend`
- pytest-timeout 2.4.0 已就位；命令带 `--timeout=120`
- 无真实百炼：空 Key 走 failed；ready 路径 Mock `tag_document` / `embed_texts`
- 测试库：pytest `tmp_path` 隔离；业务库 `backend/data/Customer_Service.db` 仍在（53248 bytes）
- 报告不写密钥/token

## 检查表

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | 非 `.md`（`guide.txt`） | 400「请重新上传」，不建行 | pytest `test_reject_non_md_and_empty_file` | 400，`VALIDATION_ERROR`，documents=0 | PASS |
| TC-01b | 空 `.md` | 400「请重新上传」，不建行 | 同上 | 400，documents=0 | PASS |
| TC-01c | 超大小（`max_upload_bytes=10`） | 400「请重新上传」，不建行 | pytest `test_reject_oversized_file` | 400，documents=0 | PASS |
| TC-01d | 合法 md | 202，`ingest_status=ingesting`，`chunks=[]` | pytest `test_valid_md_returns_202_ingesting_empty_chunks` | 202，ingesting，chunks=[]，chunk_count=0 | PASS |
| TC-02a | 多级标题且长于 800 字 | 切块数>1、position 从 1、heading_path/content 与策略一致 | pytest `test_multi_heading_long_markdown_splits_with_paths` | 块>1；`VPN / 密码重置`、`VPN / 连接失败`；正文含标题路径前缀；单块 ≤800 | PASS |
| TC-02b | 无标题长段落 | 重叠 80 字 | pytest `test_long_paragraph_uses_overlap` | 第二块前 80 字 = 第一块后 80 字 | PASS |
| TC-03a | 有 Key（Mock 打标/嵌入）一篇含多级标题 md → ready | API-005 `chunks` 条数=`chunk_count`，与切块结果一致，无 embedding | pytest `test_ready_preview_and_tag_update_keeps_chunks` | ready；条数相等；position/heading_path/content 对齐 `chunk_markdown` | PASS |
| TC-03b | ingesting / failed 详情 | `chunks=[]` | pytest `test_ingesting_and_failed_detail_chunks_empty` + 无 Key 失败详情 | ingesting chunks=[]；failed chunks=[] | PASS |
| TC-03c | API-006 非 ready | 409；ingesting 文案与 failed「请重新上传」 | pytest `test_patch_ingesting_is_409` / `test_patch_failed_is_409` | 409 CONFLICT，文案与 §二一致 | PASS |
| TC-03d | ready 改标签 | 不重切正文，chunks 不变 | `test_ready_preview_and_tag_update_keeps_chunks` PATCH object_types | 200，chunks 与改前相同 | PASS |
| TC-04a | 无 Key | 后台 failed +「请重新上传」，无 chunks/faqs 行 | pytest `test_no_key_background_fails_without_retrieval_rows` | failed；库内 chunks=0、faqs=0 | PASS |
| TC-04b | 禁止 dashscope SDK | 无 `import dashscope` / `from dashscope`；httpx `trust_env=False` | pytest + 读 `bailian.py` / `requirements.txt` | 无 SDK；requirements 无 dashscope；仅 config 默认 URL | PASS |
| TC-05 | ruff / mypy 写范围内 Python | 通过 | ruff / mypy 定向写范围 | ruff All checks passed；mypy 10 files Success | PASS |

## 实际执行

```
python -m pytest backend/tests/test_chunking.py backend/tests/test_documents.py --timeout=120 -q
# 13 passed, 46 warnings in 13.85s（警告来自 pycore/Starlette，不计入本任务）

python -m ruff check <T-007 Python write_scope>
# All checks passed

python -m mypy <T-007 Python write_scope>
# Success: no issues found in 10 source files
```

补充核对（非新需求）：

- `docs/tag-taxonomy.json` 与 `backend/src/resources/tag-taxonomy.json` 字节一致（SHA256 `b84bb2c4…161e98`）
- 切块/大小上限从 config 读取（`chunk_max_chars` / `chunk_overlap_chars` / `max_upload_bytes`）
- `DocumentUpdate` 不含 `chunks`
- 过期 ingesting：仅文档 API（list/get/upload/update）惰性调用 `fail_stale_ingesting_documents`；`main.py` 启动未标失败。按本轮任务约束不因此 FAIL

## AC

本任务 `acceptanceCriteria=[]`。F-002 / REQ-002 的 AC-003、AC-004、AC-017、AC-018、AC-023、AC-024 由 T-011 在真实页面联调，本轮不判这些 AC。

## 未验项

- 真实百炼 Chat/Embedding（无授权 Key；ready 仅 Mock）
- 进程重启后仍 ingesting 且超过 `ingest_stale_seconds` 的启动标记（未改 `main.py`，仅文档 API 惰性标记）
- 非 UTF-8 上传 400（方案有、本轮 TC 未列）
- API-004 分页列表的独立 HTTP 抽检（实现已读；无专门 pytest）
- 页面「入库中 / 请重新上传 / 分块预览」（T-011）

## 经验候选核对（不落盘）

Developer 建议：多级标题时遇下一标题只在已有正文时落 section，避免父标题无正文被 flush 成空块导致 heading_path 只有一级。

- 证据状态：**已验证**
- 代码：`parse_markdown_sections` 遇到下一标题 `flush(heading_only=False)`，无正文不落 section；标题栈仍累积
- 复验证据：`# VPN` 下接 `## Reset` 且父级无正文 → sections 仅为 `('VPN / Reset', …)`，`empty_parent_section=False`；三级 `# A / ## B / ### C` → heading_path=`A / B / C`
- 回归：`test_multi_heading_long_markdown_splits_with_paths` 断言 `VPN / 密码重置`
- 适用边界：Markdown ATX 标题分块、父标题无正文；不推广到其它切块策略
- 项目 `.sdd/experience.md` 尚无同题条目；交编排器去重后决定是否写入

## 范围外

- pycore / Starlette / Pydantic deprecation 警告
- T-005 前端 Mock、T-008 conversations；未改这些文件
