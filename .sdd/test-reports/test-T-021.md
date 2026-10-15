# T-021 Tester 报告

- 时间：2026-09-22
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`2d8455b9-66ed-49bb-961c-00bc1df978be`
- Tester 实例：本轮编排器派发的 Tester
- 模式：automatic；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`，`gate_task_id=T-021`，`tester_ready=[]`（本任务已在 `testing` / in-flight，本轮收尾验收）
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks`。后续业务 AC 由联调 **T-025 / T-026 / T-027** 关闭 Mock 后真实验收。本 PASS 不等于用户已放行门禁，Tester **未改** `user_gate` / `.sdd/tasks.json`。
- 本 PASS 不证明完整业务功能通过。

## 环境

- 工作目录：`frontend/`（本项目 Vite）
- 指纹：Harness HEAD `ec75f8f`；Customer_Service git 尚无 commit。验收时 SHA256：
  - `frontend/src/mocks/index.ts` `AD71164BE2D75D…80D7AE34`
  - `frontend/src/services/mockAdapter.ts` `5CC6A2B5368467…1A159A19`
- Mock：本进程 `VITE_USE_MOCK=true`（覆盖项目 `.env` 中的 `false`）；页面可见 `[Mock]`
- Tester 自起 Vite：`http://127.0.0.1:5206/`，`npx vite --host 127.0.0.1 --port 5206 --strictPort`，HTTP 200。未占用/未关闭 5199、8099、5202、5204、5205
- 浏览器：无头 Chrome 153.0.8010.48 + CDP **9453**，视口先 1440×900 再 900×800；独立 `user-data-dir` `t021-chrome-*`；验收后已关掉本轮 Chrome
- 账号：演示用户名 `it-help`（报告不写密码）
- 定向质量：`npm run type-check` 退出码 0；`npx eslint` 仅 T-021 改动路径（`mocks/index.ts`、`mockAdapter.ts`）退出码 0。build 沿用 Developer 自验，未全量重跑
- 证据：`.sdd/test-reports/t021-browser-evidence.json`、脚本 `t021-browser.mjs`、截图 `t021-*.png`
- 同一会话 ID（员工 / 客服 / 工单 store）：`8934bb7c-b162-4fc4-96b1-65f4f8771c53`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 错误登录 | 打开 `/login`，错误账号后点登录 | 留在登录页并看到失败说明 | CDP + `t021-login.png` | `pathname=/login`；仍有登录卡；文案含「用户名或密码」 | PASS（Mock） |
| TC-01b | 正确登录 → 知识库 | 演示账号登录后点「知识库」 | 列表主流程仍成立；原文件名；`[Mock]` | CDP + `t021-knowledge.png` | 4 行：`outlook.md` 入库中、`vpn-faq.md` 已完成、`wifi-reset.txt` 已完成、`scan-only.pdf` 请重新上传；无 `wifi-reset.md`；hint=`[Mock] 支持 Markdown、TXT，以及能抽出文字的 PDF`；四档筛选可见 | PASS（Mock） |
| TC-01c | 员工空态 | 打开 `/employee` | 「描述你的购物问题」且带 `[Mock]`；不是 IT 空态 | CDP + `t021-employee-empty.png` | 空态 `[Mock] 描述你的购物问题`；`hasItEmpty=false`；状态 `[Mock] AI 接待中`；输入钉底 `pinGap=0` | PASS（Mock） |
| TC-01d | 未转接无填单 | 转人工前打开 `/agent` | 列表无未转接会话；无确认工单 | CDP + `t021-agent-empty.png` | 列表 0 条；空态「还没有需要人工处理的对话」；`confirmText=null` | PASS（Mock） |
| TC-01e | 提问 / 转人工 | 发送「这件连衣裙能退吗」并转人工 | 有系统知识回复；转人工后状态变化 | CDP | 消息 2 条，知识「服饰美妆支持七天无理由退货，需商品完好」；状态 `[Mock] 已转人工，等待客服`；按钮禁用为「已转人工」 | PASS（Mock） |
| TC-01f | 未选售后四类 | 客服端打开该会话 | 不能确认；仍可润色发送 | CDP + `t021-draft.png` / `t021-polish.png` | 类型空、确认禁用；润色后消息数 2→2；发送后客服气泡为润色稿；确认仍禁用 | PASS（Mock） |
| TC-01g | 知识不进员工对话 | 选手选服饰 + 退换货后看员工端 | 坐席有推送；员工线程无该正文 | CDP + `t021-knowledge-push.png` / `t021-employee-after-push.png` | 坐席 `hasApparelPush=true`、无「发给用户」；员工 otherTexts 仅知识问答 + 已发客服稿，不含「签收后七日内可无理由退货，吊牌完整」 | PASS（Mock） |
| TC-01h | 确认后不能改类型 | 点确认工单 | 已确认；类型锁定 | CDP + `t021-confirmed.png` | 按钮「已确认」；`typeDisabled=true` 且值为 `return_exchange`；store `status=confirmed` | PASS（Mock） |
| TC-02a | 1440 客服布局 | 视口 1440×900 | 左 320 / 右 360；输入钉底；确认与发送不是并排两个同级主按钮 | CDP + `t021-draft.png` | 列表 320px、工作台 360px；`pinGap=0`；`sameRow=false`；润色次按钮、发送主按钮在对话底，确认主按钮在右列 | PASS（Mock） |
| TC-02b | 窄于 1024 | 视口 900×800 | UI-03 例外：列表约 40vh，工作台在对话下方；输入仍钉底；确认/发送不并排同级主按钮 | CDP + `t021-narrow.png` | `listHeightRatio=0.4`；`workBelowThread=true`；`pinGap=0`；`sideBySideEqualPrimary=false` | PASS（Mock） |
| TC-02c | 三业务页顶栏 | 员工 / 客服 / 知识库 | 「已登录：用户名」+ 次按钮「退出」一致 | CDP | 三页均为「已登录：[Mock] it-help」+「退出」且 `btn-secondary`；导航互斥 | PASS（Mock） |
| TC-03a | 复用前序证据 | 只补测跨页与本任务改动 | T-017 列表、T-019 空态、T-020 工作台仍成立 | 本轮点击 + 前序报告 | 知识库种子与筛选仍在；购物空态仍在；工单/润色/知识分区仍在。跨页同一 `conversation_id`，工单 store 同 id | PASS（Mock） |
| TC-03b | Mock 标识与信封 | 页面与 handler | 展示带 `[Mock]`；信封未偏离 §二 | 页面 + `import` handler | 登录/列表/会话/工单/知识推送/润色信封均含 `success/data/error/error_code/message/timestamp/request_id/metadata`；列表另有 `pagination`；润色无 `message_id` | PASS（Mock） |
| TC-quality | type-check / lint | `npm run type-check`；eslint 改动路径 | 按改动通过 | 命令 | 两者退出码 0 | PASS |

## 未验 / 责任外

- 业务 AC：T-025（电商问答 / AC-001、012～016、019、021 等）、T-026（填单确认 / AC-030～034、041）、T-027（知识推送、润色发出、未选类型 / AC-035～040、042、043）。关闭 Mock 后真实验收。
- 用户门禁：本 PASS 后由编排器将 `user_gate` 置 `awaiting_user`。Tester **未设置**门禁。
- 真实百炼 / 关 Mock / 用户验收端口 5175：本轮未启。
- T-017 上传失败分支、T-020 手改不被覆盖 / 发票字段对照：本轮只抽检跨页主路径，不重跑全量。

## 观察（不计入失败）

- 售前（未选四类）右列仍出现通用字段框，但「确认工单」禁用。T-021 TC 要求的是不能确认且可润色发送，已满足。
- 登录页辅助说明含演示账号与口令明文。`write_scope` 不含 `LoginPage`，属存量问题，不计入本轮失败；报告不复述口令。
- 知识推送卡片在工作台底部，1440 截图需滚动才完整入镜；DOM `hasApparelPush=true` 且员工线程无该句。

## 门禁提示（交编排器）

需交用户验收本轮 Mock；已确认且未变的百炼配置只核对状态，不要求重填密钥。不要把 Tester PASS 当用户放行，也不开始 T-025～T-027。

可复用启动（用户门禁约定端口 5175）：

```
cd frontend
$env:VITE_USE_MOCK='true'
npx vite --host 127.0.0.1 --port 5175 --strictPort
```

本轮 Tester 预览为 `http://127.0.0.1:5206/`（仅验收进程，已按规范自关）。

## 经验候选

无。
