# T-011 验收报告

- 任务：T-011 联调知识入库、入库中、失败、分块预览与列表筛选
- 总结果：**PASS**
- 路径：真实后端 `http://127.0.0.1:8099` + 前端 `http://127.0.0.1:5199`，`VITE_USE_MOCK=false`，页面无 `[Mock]`
- 未改业务代码、未改 `tasks.json`、未杀 5199/8099、未写密钥

## 环境

| 项 | 实际 |
| --- | --- |
| 前端 | HTTP 200，`VITE_USE_MOCK=false`，`VITE_POLL_INTERVAL_MS=3000`，`isMockEnabled()=false` |
| 后端 | HTTP 200 `/docs`，百炼 Chat/Embedding **已配置**（本任务最小次数打标、嵌入、提问） |
| 登录 | `it-help`（密码未写入本报告） |
| 浏览器 | 无头 Chrome + CDP，端口 9379 / 9383 / 9388，user-data-dir `t011-chrome-*`（未占用 9368 / 9357） |
| 数据库 | 真实业务库；本轮只新增测试文档，未清库 |

## 逐 AC

| AC | 结果 | 实际 | 证据 |
| --- | --- | --- | --- |
| AC-003 | **PASS** | Markdown `t011-helix-vpn.md` 全链路：ready、2 块、打标、抽出 FAQ；页面可改标签/FAQ。用抽出 FAQ「T011Helix VPN 密码重置流程是什么？」提问命中 FAQ（账号中心重置/导入配置）。用非 FAQ、带 T011HELIX-FAIL 的问题得到「知识问答」并引用该篇正文。TXT `t011-office-wifi.txt`、PDF `t011-printer-guide.pdf` 均 ready，页面可见标签与 FAQ。 | 截图 `t011-md-ready.png`、`t011-txt-ready.png`、`t011-pdf-ready.png`；`t011-ready-docs.json`；`t011-browser-phase2.json` → `ac003-md-faq-intercept`、`ac003-txt-tag-retrieval`、`ac017-new-tag-question` |
| AC-004 | **PASS** | `.docx`、空 `empty.txt`、pypdf 空白 PDF 均立刻「请重新上传」；列表不出现这些文件名。API 均为 HTTP 400、`error=请重新上传`、`VALIDATION_ERROR`，上传前后列表 total 仍为 0。未构造后台入库失败（请求期失败已覆盖格式/空文件/无文字 PDF）。 | `t011-api-precheck.json` `rejects`；截图 `t011-reject-docx.png`、`t011-reject-blank-pdf.png` |
| AC-017 | **PASS** | 将 `t011-helix-vpn.md` 对象标签改为仅「硬件设备」并保存，页面「当前标签」立即含硬件设备。随后问「T011HELIX-FAIL 认证失败是不是网卡硬件坏了」→「知识问答」，正文引用该篇访客 WiFi / 认证失败步骤（新标签范围内召回）。之后重开文档仍勾选硬件设备。 | `t011-tag-saved.png`、`t011-p3-md-hardware.png`；`t011-browser-phase2.json` `hardwareAsk`；`t011-browser-phase3.json` `ac017-md-shows-hardware` |
| AC-018 | **PASS** | 在知识库页把 FAQ 整段替换为「T011HELIX 重置 VPN 密码的要点是什么 / T011HELIX-FAQ-NEW …」并保存。GET 详情立即只有这条新 FAQ。员工按新问法提问 → FAQ 气泡且答案含 `T011HELIX-FAQ-NEW`。按旧问法提问不再出现旧答案「等待一分钟」，而是新 FAQ 答案（问法相近仍走 FAQ 向量，但旧答案已替换）。 | `t011-browser-phase3.json` `faqSaved.api`、`newFaqAsk`、`oldFaqAsk`；`t011-p3-faq-saved.png` |
| AC-023 | **PASS** | 合法上传后列表最前「入库中」、详情「正在入库中」、无分块、无编辑表单。切到员工端再回知识库，该条仍在且仍为入库中、仍不能预览/改标签 FAQ。入库完成前用该篇独有 token 提问 →「兜底」，未命中 FAQ/知识。 | `t011-p3-stay-ingesting.png`、`t011-p3-stay-back.png`、`t011-md-ingesting.png`；phase2 `ac023-ask-not-hit-ingesting`；phase3 `ac023-leave-return-still-ingesting` |
| AC-024 | **PASS** | ready 后策略句含「先转为 Markdown」、800 字、重叠 160 字（上限 20%），无「重叠 80 字」。`t011-helix-vpn.md` 页面 2 块 = API-005 `chunks.length` = `chunk_count`。可见序号与标题路径 `T011Helix VPN / 密码重置`、`T011Helix VPN / 连接失败`；分块只读、无「保存分块」。父标题无单独空块。 | `t011-md-ready.png`；phase1 控制台 `ac024-*`；`t011-ready-docs.json` heading_paths |
| AC-029 | **PASS** | 超 800 字 TXT（14 段 T011WIFI）ready 后 3 块，`heading_path` 全空，正文来自转换后段落而非 `.md` 文件名。可抽文字 PDF（T011PRINTER）ready 后 6 块，`heading_path` 全空，正文含抽出文字、不含 `%PDF`。列表文件名仍为 `.txt` / `.pdf`。 | `t011-txt-ready.png`、`t011-pdf-ready.png`；`t011-ready-docs.json`；phase1 `ac029-*` |
| AC-027 | **PASS** | 多篇 `updated_at` 降序；新上传在最前且为「入库中」。行上为原文件名（`.md`/`.txt`/`.pdf`）、中文状态、本地时间到分钟（如 `9月17日 11:50`），不展示 `created_at`。 | `t011-p3-stay-ingesting.png` 列表；phase1 `ac027-*` |
| AC-028 | **PASS** | 四档单选。空库时「全部」为「还没有知识文档…」；「入库中 / 已完成 / 请重新上传」空态为「当前没有该状态的文档」，上传仍可用。有文档后筛「入库中/请重新上传」与 API 条数一致。在「已完成」下上传合法文档 → 自动切到「全部」，新条最前「入库中」。 | `t011-empty-all.png`、`t011-empty-ingesting.png`、`t011-p2-filter-ingesting.png`、`t011-upload-from-ready.png`；`t011-browser-phase2.json` `ac028-filter-*-synced` |

## 技术检查

| ID | 结果 | 说明 |
| --- | --- | --- |
| TC-01 上传 202 / 原名 / 轮询 / 块数 | **PASS** | POST `/api/documents` HTTP 202，`ingest_status=ingesting`，filename 为原名。存在约 3s 的 GET 列表轮询。ready 后 API-005 chunks 与页面块数一致（MD 2、TXT 3、PDF 6）。 |
| TC-02 请求期失败 | **PASS** | 非三种扩展名、空文件、抽不出文字 PDF → HTTP 400「请重新上传」，不建行。Key 已配置，AC-003/017/018/024/029 已真实验证，未 BLOCKED。 |
| TC-03 切块策略与 AC-029 | **PASS** | 对照 D-002=B、D-005、UI-04。策略可见先转 Markdown、800、重叠 160。TXT/PDF 无标题则 `heading_path=""`. |
| TC-04 API-004 筛选 | **PASS** | 不传 `ingest_status` 返回全部且 `updated_at` 降序；分别传 ingesting/ready/failed 只含对应状态；`ingest_status=bogus` → 400「入库状态筛选无效」。字段仍为 DocumentListItem。 |
| TC-05 浏览器关 Mock | **PASS** | 无 `[Mock]`；原文件名、中文状态、本地时区到分钟；四档单选；筛空文案；「已完成」下上传切到「全部」。未使用 T-015/T-017 Mock 证据。 |

## 执行摘要

1. `t011-precheck.py`：环境、非法筛选、请求期拒绝、空白/带字 PDF 夹具。
2. `t011-browser.mjs`：关 Mock、筛空、拒绝上传、三种格式入库至 ready、分块预览、列表筛选与从「已完成」上传。
3. `t011-browser-phase2.mjs`：筛选与 API 对齐、入库中提问不命中、FAQ 拦截、改标签后知识问答、TXT 标签检索。
4. `t011-browser-phase3.mjs`：FAQ 保存后立即提问、离开再回仍入库中。

百炼调用：入库打标/抽 FAQ/嵌入 + 员工提问（FAQ/知识/兜底），均在本任务授权的最小范围内。未出现需把分类/429 当超范围的情况。

## 观察（不计入失败）

- 保存 FAQ 后，脚本在「已保存」文案出现的当帧仍读到旧 input 值；同刻 GET 已是新 FAQ，随后提问也命中新答案。判断为详情本地 state 与 `detail` 同步时序，不推翻 AC-018。
- 旧 FAQ 问法在向量上仍可能命中**新** FAQ（问法相近）；AC 要求的是不再命中**旧答案**，本轮满足。
- 经验「父标题无正文不落空块」：MD 两块路径均为 `T011Helix VPN / …`，无空父标题块。

## 证据路径

目录：`Projects_Repo/Customer_Service/.sdd/test-reports/`

- 报告：`test-T-011.md`
- JSON：`t011-api-precheck.json`、`t011-ready-docs.json`、`t011-browser-phase2.json`、`t011-browser-phase3.json`
- 脚本：`t011-precheck.py`、`t011-browser.mjs`、`t011-browser-phase2.mjs`、`t011-browser-phase3.mjs`
- 截图：`t011-empty-all.png`、`t011-reject-docx.png`、`t011-md-ingesting.png`、`t011-md-ready.png`、`t011-txt-ready.png`、`t011-pdf-ready.png`、`t011-tag-saved.png`、`t011-p2-filter-ingesting.png`、`t011-p3-stay-ingesting.png`、`t011-p3-stay-back.png` 等
