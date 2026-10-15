# T-015 Tester 报告

- 时间：2026-09-17
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`01514f7d-28bf-48b9-a4a8-0b75823743d6`
- 模式：automatic；`gate_phase=frontend_in_progress`，唯一 `user_gate` 在 **T-017**（pending），本任务无门禁
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验 `technicalChecks`。业务 AC-027 / AC-028 由联调 **T-011** 验收。本 PASS 不证明完整业务功能，不等于用户已放行门禁，也不开始 T-017。

## 环境

- 工作目录：`frontend/`；`VITE_USE_MOCK=true`（`frontend/.env`）
- 指纹：Harness HEAD `ec75f8f`；本项目仓库尚无 commit
- 服务：复用已监听 Vite `http://127.0.0.1:5199/`（HTTP 200，`Customer_Service/frontend`）与后端 8099。Tester **未关闭** 5199 / 8099。Mock 在浏览器 JS；未把 `curl /api/documents` 当 Mock 证据。
- 账号：演示用户名 `it-help`（报告不写密码）
- 视口：1440×900；无头 Chrome + CDP 9346（独立 `user-data-dir` `t015-chrome-*`，不与其他智能体会话共用）
- 登录后对知识库页 `Page.reload({ ignoreCache: true })` 硬刷新再点击
- 时区：`Asia/Shanghai`
- 质量抽检：本轮 `npm run type-check` 退出码 0。lint/build 沿用 Developer 自验，未全量重跑。
- 证据：`.sdd/test-reports/t015-browser-evidence.json`、脚本 `t015-browser.mjs`、截图 `t015-*.png`
- 验收后：已关掉本轮 Chrome/CDP；5199 / 8099 仍在（他方进程）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 种子至少两篇、不同 `updated_at` | 硬刷新后打开知识库，默认「全部」 | 最近更新在上；每行文件名 + 中文状态 + 本地时区到分钟；无秒、无 `created_at`；带 `[Mock]` | Chrome CDP + `t015-baseline-all.png` | `[Mock] outlook.md` 入库中 · 9月14日 12:12（对应 `2026-09-14T04:12:00.000Z`）；`[Mock] vpn-faq.md` 已完成 · 4 块 · 9月13日 18:00。时间 12px `rgb(92,107,122)`。无秒、无 ISO/`created_at` | PASS（Mock） |
| TC-01b | 布局 UI-04 / 原型 04-knowledge | 视口 1440×900 看上传条与左列 | 筛选胶囊在左列顶；上传条不放筛选；左列约 320px；上传条 ≥64px；胶囊 32px / 6px / 12px；选中 PrimarySubtle+Primary | Chrome CDP 几何 + 截图 | 筛选在 `.kb-list > .kb-filter`，`filterTop < listScrollTop`；上传条无四档按钮；`listWidth` 320；上传高 ≥64；选中 `rgb(232,241,250)` / `rgb(29,78,137)` | PASS（Mock） |
| TC-01c | 上传合法 `.md` | 在会藏住新文档的筛选下上传 | 新条最前、「入库中」、当前本地时间到分钟 | `t015-from-failed.md` / `t015-from-ready.md` | 上传后切到「全部」；`t015-from-failed.md` / `t015-from-ready.md` 均最前、入库中、时间 `9月17日 15:16` 与当时本地分钟一致。见 `t015-upload-from-failed.png`、`t015-upload-from-ready.png` | PASS（Mock） |
| TC-02a | 四档单选 | 点 全部 / 入库中 / 已完成 / 请重新上传 | 全部显示所有且倒序；其余只显示对应状态 | CDP + `t015-filter-*.png` | 全部：outlook 入库中 + vpn 已完成。入库中：仅 outlook。已完成：仅 vpn。请重新上传：0 行 | PASS（Mock） |
| TC-02b | 筛空 | 种子无 failed 时点「请重新上传」 | 「当前没有该状态的文档」，上传条仍可用 | `t015-filter-failed-empty.png` | 文案 `[Mock] 当前没有该状态的文档`；`fileDisabled=false`，`uploadDisabled=false` | PASS（Mock） |
| TC-02c | 上传后切全部 | 在「请重新上传」或「已完成」下传合法 `.md` | 筛选变「全部」，新文档最前且入库中 | 两次上传 | `filterPressedValue=all`；新文件名在第一行且「入库中」 | PASS（Mock） |
| TC-02d | 保持筛选 | 已是「入库中」或「全部」时再上传 | 筛选保持；新条最前入库中 | `t015-keep-ingesting.png`、`t015-keep-all.png` | 入库中保持，4 行全是入库中，`t015-keep-ingesting.md` 第一。全部保持，`t015-keep-all.md` 第一 | PASS（Mock） |
| TC-02e | Mock 拉列表参数 | 点四档时拦截 `toListQuery` / `listDocuments` | 「全部」不传 `ingest_status`；其余 `ingesting` / `ready` / `failed` | CDP 条件断点，19 次调用 | `filter=all` 的 `queryKeys` 仅为 `page`,`page_size`；其余带对应 `ingest_status` | PASS（Mock） |
| TC-02f | `[Mock]` | 顶栏、文件名、状态行、空态 | 界面 Mock 数据带 `[Mock]` | 截图与 DOM | 顶栏「已登录：[Mock] it-help」；文件名、时间、空态、详情均有 `[Mock]` | PASS（Mock） |
| TC-03 | 范围外 | 不验 `.txt`/`.pdf`、800/160、扫描 PDF | 本任务不因此失败；策略重叠 80 字可接受 | 点 vpn-faq 详情 | 详情为「块间重叠 80 字」，无 160。未测 txt/pdf。不计入失败 | PASS（范围确认） |

## 未验 / 责任外

- 业务 AC-027 / AC-028：T-011 关 Mock 真实验收。本轮不计业务 AC 完成。
- `.txt` / `.pdf` 上传、切块说明 800/160、抽不出文字的 PDF：T-017。
- 唯一前端 `user_gate`：T-017，Tester 不改门禁。
- 关闭 Mock 后的真实 API-004 / 入库。
- lint / build 本轮未重跑（type-check 已抽检通过）。

## 观察（不计入失败）

- 列表 + 轮询竞态（Developer 经验候选）：本轮独立操作 3 次「全部」→ 等待约 2.8–3.1s（轮询 3s）→「已完成」，随后 2.2s 内采样行状态。**未看到** 筛选停在「已完成」时被过期「全部」结果盖成含「入库中」的列表（`race.hits=[]`，`observedStaleAllOverwrite=false`）。Mock 的 `listDocuments` 同步完成，点击作为宏任务很难插进该 await。真实 HTTP 延迟下是否仍会发生，本任务 Mock 不能证实。Tester **不写** `experience.md`，交编排器决定是否落盘。
- 上传辅助说明仍为「仅支持 Markdown（.md）」，属 T-017 文案增量，本任务不失败。
- 种子 `outlook.md` 的 `ready_at` 为 null，会一直「入库中」，便于筛空「请重新上传」和保持「入库中」。

## 经验候选核对

- 候选：筛选切换与列表轮询竞态，过期「全部」响应覆盖当前筛选。
- 本轮：必要用户路径下 **未复现**。适用边界：当前 Mock 同步列表；未在慢请求下验证。功能 PASS 不自动证明该根因存在或已修复。

## 门禁提示（交编排器）

本任务 **无** `user_gate`。预览仍为 http://127.0.0.1:5199/ （`VITE_USE_MOCK=true`）。整体 Mock 收口与用户验收在 T-017。Tester PASS ≠ 用户已放行。
