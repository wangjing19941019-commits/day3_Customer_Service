# T-018 Tester 报告

- 任务：T-018 后端：API-003 接受 md/txt/pdf、先转 Markdown 再切块
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-002`（REQ-002）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-17
- 业务 AC-003 / AC-004 / AC-023 / AC-024 / AC-029 由 T-011 真实验收，本轮不判
- Tester 未改业务代码、未改 `.sdd/tasks.json`、未 git commit/push、未杀 5199/8099、未调用百炼、未写入 `llm_api_key`

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- 工作目录：项目根 `Projects_Repo/Customer_Service`
- `PYTHONPATH`：`pyproject.toml` `pythonpath = [".", "backend"]`
- pytest 9.1.1；pytest-timeout 2.4.0；pypdf 5.9.0
- 命令带 `--timeout=120`（插件已识别，timeout method=thread）
- 隔离库：pytest `tmp_path` / 一次性 TestClient 临时库；未连 8099，未写 `backend/data/Customer_Service.db`
- 业务库仍为 53248 bytes，mtime 2026-09-12 17:33:41 +08:00（pytest 与独立探测前后不变）
- 5199 Vite、8099 uvicorn 仍为 running，本轮未重启、未结束
- `sdd_dispatch.py`：exit 0；`execution_mode=automatic`；`gate_phase=frontend_in_progress`（T-017）；`in_flight_or_queued` 含 T-018；本轮收尾当前验收，不续派
- `specification=default`；rules 已按任务清单加载，未另选规范
- 报告不写密钥/token；无 Key 路径只验受理 + failed，ready 路径用 monkeypatch 假打标/假嵌入

## 检查表

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | 合法 `.md` / `.txt` / 可抽出文字的 `.pdf` POST `/api/documents` | HTTP 202；`ingest_status=ingesting`；`filename` 为原名；`chunks=[]`、`chunk_count=0` | pytest `test_valid_md_returns_202_ingesting_empty_chunks`、`test_valid_txt_and_pdf_return_202_with_original_filename`；独立 TestClient 大小写扩展名 | md：202，`vpn-guide.md`，ingesting，chunks=[]。txt：202，`notes.txt`。pdf：202，`policy.pdf`。大写 `VPN-GUIDE.MD` / `Notes.TXT` / `Policy.PDF` 亦为 202 且原名保留、md 的 chunks=[] | PASS |
| TC-01b | `.docx`、空 `.txt`/`.md`、空字节 PDF、空白页 PDF、损坏 PDF | HTTP 400；`error`「请重新上传」；`error_code=VALIDATION_ERROR`；库中无新行 | pytest `test_reject_unsupported_empty_and_unreadable_pdf`；独立探测 `.docx` | 6 个坏文件均为 400 + 该文案 + VALIDATION_ERROR，`documents` 计数保持 0。独立 `.docx` 后行数不变 | PASS |
| TC-02a | 无标题 TXT >800 字；可抽出长文 PDF | 先 `convert_file_to_markdown` 再 `chunk_markdown`；块数>1；position 从 1；重叠 160；无标题则 `heading_path=""` | pytest `test_headingless_txt_convert_then_chunk`、`test_pdf_long_body_convert_then_chunk`、`test_ready_txt_and_pdf_convert_then_chunk`；独立 convert/chunk | TXT：2 块，position 1..n，heading_path 全空，块 2 前 160 字 = 块 1 后 160 字。PDF：抽出 1679 字，3 块，同样 overlap 160、heading_path 空。ready 路径（假 LLM）块内容与 convert-then-chunk 一致，filename 仍为 `long.txt` / `long.pdf` | PASS |
| TC-02b | 含多级标题的 `.md` | 仍按标题路径切；父标题无正文不成空块 | pytest `test_multi_heading_long_markdown_splits_with_paths`、`test_parent_heading_without_body_is_not_a_chunk`、`test_ready_preview_and_tag_update_keeps_chunks` | 首块 `heading_path=VPN / 密码重置`；`# A / ## B / ### C + 正文` 只有 `A / B / C` 一块且 content 非空。经验「Markdown 切块：父标题无正文不落空块」在 overlap=160 下仍成立 | PASS |
| TC-02c | config 默认重叠 | `chunk_overlap_chars` 默认 160；`.env.example` 与 `AppSettings` 同步 | pytest `test_chunk_overlap_default_is_160`；读 `session.py` / `.env.example` | `AppSettings.chunk_overlap_chars` default=160；`.env.example` 含 `chunk_overlap_chars=160`；ingest 后台 `chunk_markdown(..., settings.chunk_overlap_chars)` | PASS |
| TC-03a | requirements / 抽取路径 | 含 pypdf；仅本地解析；无 dashscope SDK | pytest `test_no_dashscope_sdk_in_write_scope`、`test_conversion_is_local_only`；读 requirements、text.py、bailian.py | `pypdf>=5.0.0,<6`；`from pypdf import PdfReader`；`text.py` 无 httpx / dashscope import；`requirements.txt` 无 dashscope 包；`bailian.py` 用 httpx 而非 SDK。已装 pypdf 5.9.0 | PASS |
| TC-03b | 转换/切块测试不发百炼 | 不发网络 LLM 请求 | 读测试：chunking 无 BailianClient；documents ready 路径 monkeypatch `tag_document`/`embed_texts`；无 Key 在 `has_llm_key` 处抛错，未 `_post` | 无 Key 日志为 `BailianError: 未配置模型密钥`（ingest.py:308），发生在构造客户端请求之前。转换函数本身无网络。本轮未向 dashscope 发请求 | PASS |
| TC-04 | 无 Key 上传合法文件 | 仍可 202 ingesting；后台 failed +「请重新上传」；无 FAQ/分块行 | pytest `test_no_key_background_fails_without_retrieval_rows`、`test_no_key_txt_and_pdf_fail_without_retrieval_rows` | md/txt/pdf 均先 202；随后详情 `failed` +「请重新上传」；`chunks=[]`、`faqs=[]`；SQLite `chunks`/`faqs` 对该 document_id 计数为 0。未走付费 ready | PASS |
| T-016 回归 | API-004 `ingest_status` 过滤 | 不传=全部降序；三值过滤；非法 400「入库状态筛选无效」；不重开 T-016 | pytest `test_list_documents_filter_sort_and_pagination`、`test_list_documents_invalid_ingest_status_is_400` | 不传 ids=`doc-ready-new, doc-ingesting, doc-ready-old, doc-failed`，`total_items=4`。ingesting/failed 各 1 条。ready `page_size=1` 两页、`total_items=2`。`unknown` / 空串 / `Ready` 均为 400 VALIDATION_ERROR，`data` 非列表 | PASS |

## 实际执行

```
sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-015 --running-task T-018 --running-task T-009
# exit 0；execution_mode=automatic

.venv\Scripts\python.exe -m pytest backend/tests/test_chunking.py backend/tests/test_documents.py --timeout=120 -v
# collected 24 items
# 24 passed, 75 warnings in 20.15s
# 警告来自 pycore/Starlette/Pydantic datetime.utcnow，不计入本任务
```

独立探测（临时 SQLite + TestClient，不连 8099）：

- 无标题 TXT 2 块、overlap 160、heading_path 空；TXT 中 `# 看起来像标题` 被转义，不编造 heading_path
- 长 PDF 抽出 1679 字、3 块、overlap 160、heading_path 空；空白 PDF 抽出为空
- 多级 md 标题路径保留；空父标题不成块
- 大写扩展名 `.MD`/`.TXT`/`.PDF` 202 且原名；`.docx` 400「请重新上传」且不建行
- 无 Key 后台日志为缺密钥失败，未付费调用

## AC

本任务 `acceptanceCriteria=[]`。关联 AC-003、AC-004、AC-023、AC-024、AC-029 的后端契约由本轮 technicalChecks 覆盖；知识库页面上传/预览/失败文案由 T-011 在关闭 Mock 后用真实 API 验收。本轮不开始业务联调，不把后端阶段 PASS 写成完整业务通过。

## 经验核对

读取 `.sdd/experience.md`「Markdown 切块：父标题无正文不落空块」。原条目写 overlap 80；本任务 overlap 已改为 160。复验 `# A` / `## B` / `### C` + 正文：仅一块 `A / B / C`，无空父块。已验证：该修复在 overlap=160 下仍适用。未扩大为跨项目推广。Tester 不写经验库。

## 未验项

- 真实浏览器知识库上传 md/txt/pdf 与分块预览（T-011）
- 真实百炼 ready/打标/嵌入（派发禁止付费；TC-04 允许 monkeypatch，不要求 live Key）
- 8099 现役进程上的 HTTP（按派发用隔离 TestClient / tmp DB）
- 扫描件 OCR（方案明确本轮不做）

## 范围外

- `backend/tests/test_sessions.py`、`test_qa.py`、`test_conversations.py` 夹具仍写 `chunk_overlap_chars: 80`；生产默认与 T-018 测试已是 160。不计入本任务 FAIL
- `docs/decisions.md` D-005 历史表述仍含「重叠 80 字」；tech-spec §七与 `.env.example` 已为 160。不重开决策任务
- 独立探测在无 Key 且 TestClient 等后台跑完后再拉 `ingest_status=ingesting` 得到 `total_items=0`，因这三篇已变为 failed；T-016 过滤以 pytest 植入 ingesting 行的用例为准，不视为过滤回归
- 未重跑 `test_conversations` / `test_qa`（T-009 范围；派发要求不占用其验收）
