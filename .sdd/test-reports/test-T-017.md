# T-017 Tester 报告

- 时间：2026-09-17
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`4036429f-f34f-4761-a9c2-f09e1d53754e`
- Tester 实例：`5aade0a7-c0c3-4f64-a1d0-f05313997652`
- 模式：automatic；`gate_phase=frontend_in_progress`，唯一 `user_gate` 在 **T-017**（pending）。Tester **未改** `tasks.json` / 门禁。
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验 `technicalChecks`。业务 AC-003 / 004 / 023 / 024 / 027 / 028 / 029 由联调 **T-011** 验收。本 PASS 不证明完整业务功能，不等于用户已放行门禁，也不开始 T-011。

## 环境

- 工作目录：`frontend/`；`VITE_USE_MOCK=true`（`frontend/.env`）
- 指纹：Harness HEAD `ec75f8f`；本项目仓库尚无 commit
- 服务：复用已监听 Vite `http://127.0.0.1:5199/`（HTTP 200）与后端 8099。Tester **未关闭** 5199 / 8099。Mock 在浏览器 JS；未把 `curl /api/documents` 当 Mock 证据。未调用付费 LLM。
- 账号：演示用户名 `it-help`（报告不写密码）
- 视口：1440×900；无头 Chrome + CDP **9357**（独立 `user-data-dir` `t017-chrome-*`，不与 T-015 的 9346 或其他智能体会话共用）
- 登录后对知识库页 `Page.reload({ ignoreCache: true })` 硬刷新，使 v4 种子替换旧列表
- 质量抽检：本轮 `npm run type-check` 退出码 0。lint/build 沿用 Developer 自验，未全量重跑。
- 证据：`.sdd/test-reports/t017-browser-evidence.json`、脚本 `t017-browser.mjs`、截图 `t017-*.png`
- 验收后：已关掉本轮 Chrome/CDP；5199 / 8099 仍在（他方进程）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 文件选择 + UI-04 提示 | 硬刷新知识库 | `accept` 含 `.md/.txt/.pdf`；提示原文「支持 Markdown、TXT，以及能抽出文字的 PDF」；带 `[Mock]`；对照原型 04-knowledge | Chrome CDP + `t017-baseline-all.png` | `accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf"`；hint=`[Mock] 支持 Markdown、TXT，以及能抽出文字的 PDF`。筛选在左列顶、上传条无筛选、左列 320px。视口 1440×900 | PASS（Mock） |
| TC-01b | v4 种子原文件名 | 硬刷新后看列表 | `wifi-reset.txt` / `scan-only.pdf` 保持原扩展名，不改成 `.md` | CDP + 截图 | 列表：`outlook.md` 入库中、`vpn-faq.md` 已完成、`wifi-reset.txt` 已完成 2 块、`scan-only.pdf` 请重新上传。无 `wifi-reset.md` | PASS（Mock） |
| TC-01c | 合法三种格式立刻入库 | 上传 `office-notes.md`、`office-wifi.txt`、`guide.pdf` | 立刻「入库中」；行上原名，`guide.pdf` 不显示成 `.md` | CDP + `t017-upload-three-types.png` | 三条均最前入库中；文件名分别为 `.md` / `.txt` / `.pdf`。`guide.pdf` 未改名 | PASS（Mock） |
| TC-02a | 错误扩展名 / 空文件 / 扫描 PDF | 传 `notes.docx`、空 `empty.txt`、夹具 `scan-only.pdf`、无 Tj 的 `image-only.pdf` | 立刻「请重新上传」，列表无新行 | CDP + `t017-reject-docx.png`、`t017-reject-scan-only.png`、`t017-reject-image-pdf.png` | 四次均 `[Mock] 请重新上传`；`scan-only.pdf` 行数 1→1；无 `notes.docx` / `empty.txt` / `image-only.pdf` | PASS（Mock） |
| TC-02b | T-015 四档筛选 | 点 全部 / 入库中 / 已完成 / 请重新上传 | 其余三项只显示对应状态 | CDP + `t017-filter-*.png` | 入库中仅该状态；已完成仅已完成；请重新上传含种子 `scan-only.pdf` | PASS（Mock） |
| TC-02c | 上传后切全部 | 在「请重新上传」「已完成」下传合法 `.md` | 筛选变「全部」，新条最前且入库中 | `t017-upload-from-failed.png`、`t017-upload-from-ready.png` | `from-failed.md` / `from-ready.md` 均切到全部、第一行、入库中 | PASS（Mock） |
| TC-02d | 筛空 / 全空文案 | v4 种子四种状态都有，故在隔离会话只留 ready 后再筛；再清空 store | 「当前没有该状态的文档」；全空「还没有知识文档。请上传 Markdown、TXT 或能抽出文字的 PDF。」；上传条仍可用 | `t017-empty-ingesting.png`、`t017-empty-failed.png`、`t017-empty-all.png` | 入库中/请重新上传空态均为 `[Mock] 当前没有该状态的文档`；全空为 UI-04 新文案；`uploadDisabled=false` | PASS（Mock） |
| TC-03 | 已完成详情切块说明 | 打开种子 `wifi-reset.txt` 与 `vpn-faq.md` | 先转 Markdown；800；重叠 160（20%）；无标题则路径为空。不得再写重叠 80 或「仅 Markdown」 | CDP + `t017-wifi-detail.png` | 策略句含先转为 Markdown / 800 / 重叠 160 字（上限的 20%）。wifi：2 块，meta 仅「分块 N」，相邻块重叠 160。vpn 有标题路径。无 80、无「仅 Markdown」。分块只读 | PASS（Mock） |
| TC-04 | Mock 入库 convert-then-chunk | 上传超 800 字无标题 TXT、可抽出长文 PDF（raw 字节另含 `# Fake Heading`）；等 ready | 先转 Markdown 再同一套切块；块数>1；重叠 160；无标题 heading_path 空；不得切 raw txt/pdf | 页面分块 + 页内 `import('/src/mocks/documents.ts')` 对照 store。`t017-txt-ready-chunks.png`、`t017-pdf-ready-chunks.png` | TXT/PDF 各 3 块、heading 空、重叠 160。store 的 chunks 与 convert→chunk 结果一致。PDF `source_text` 等于抽出文字而非 `%PDF` raw。对 raw PDF 切块会出现 `Fake Heading`，页面/入库未出现。`CHUNK_OVERLAP_CHARS=160` | PASS（Mock） |
| TC-05a | 跨页顶栏与退出 | 知识库 / 员工端 / 客服端顶栏；各页点退出 | 「已登录：[Mock] it-help」+「退出」；退出后登录页「当前未登录」 | CDP + `t017-logout-knowledge.png` 等 | 三页顶栏一致；三页退出均回 `/login` 且「当前未登录」 | PASS（Mock） |
| TC-05b | 员工/客服主路径与关键失败 | 员工发 FAQ 与含糊问；客服端无转接 | FAQ 气泡；反问；客服空态 | `t017-employee-faq.png`、`t017-agent-empty.png` | 「Outlook 打不开」→ FAQ；「连不上」→ 反问。客服端「还没有需要人工处理的对话」。转人工后客服回复闭环沿用 T-005 稳定证据，本增量未改会话 Mock | PASS（Mock） |

## 定向复核

- 脚本曾把首屏 `sessionStorage` 尚无 `customer_service_mock_documents_v4` 记为失败。复核：硬刷新后内存种子已是 v4 内容（`wifi-reset.txt` / `scan-only.pdf`）；首次 `persist`（上传）后 key 为 v4，且无 v3。这是延迟写入，不是旧列表。**不计入失败。**

## 未验 / 责任外

- 业务 AC-003 / 004 / 023 / 024 / 027 / 028 / 029：T-011 关 Mock 真实验收。本轮不计业务 AC 完成。
- 关闭 Mock 后的真实 API-003～006、PDF 本地解析、百炼打标。
- 员工转人工 → 客服回复同一会话：沿用 T-005 PASS，本轮只做 FAQ/反问/客服空态与三页退出。
- lint / build 本轮未重跑（type-check 已抽检通过）。
- 用户门禁预览端口 5175 / 后端 8003：本轮未启。

## 观察（不计入失败）

- v4 种子四种状态都有文档，默认「请重新上传」不再为空。筛空仍可用，须在没有该状态文档时出现。
- 界面 Mock 数据带 `[Mock]`。

## 门禁提示（交编排器）

需交用户验收 Mock，并在 `backend/.env` 填写百炼 Chat / Embedding 等配置后再放行联调。可复用启动：`cd frontend && npm run dev -- --host 127.0.0.1 --port 5199`（`VITE_USE_MOCK=true`）。用户门禁验收端口约定为 5175。Tester PASS ≠ 用户已放行。不要开始 T-011。

## 经验候选

无。
