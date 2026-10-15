# T-002 Tester 报告

- 时间：2026-09-13
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`294ac335-7f45-43c8-927a-9af26bf6a8ad`
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-005
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks`。关联 AC-001、AC-002、AC-006、AC-007、AC-011～AC-016、AC-019～AC-022 由 T-012 真实验收；转人工跨页由 T-005/T-013 收口。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`（本项目 Vite）
- 指纹：Harness HEAD `ec75f8f`；Mock 默认开（`VITE_USE_MOCK` 未关）
- 复用已有 Vite：`http://127.0.0.1:5199/`，进程为 `Customer_Service/frontend` 的 `vite --host 127.0.0.1 --port 5199`（HTTP 200）。Tester 未另起、未关闭该进程。
- 浏览器：无头 Chrome + CDP，视口 1440×900，独立 user-data-dir；验收后已关掉本轮 Chrome
- 账号：演示用户名 `it-help`（报告不写密码）
- 定向质量：`npx eslint` 仅 T-002 路径退出码 0；本轮全量 `npm run type-check` 亦为 0（未把并行任务编译失败记入本任务）
- 证据：`.sdd/test-reports/t002-browser-evidence.json` 与 `t002-*.png`；脚本 `t002-browser.mjs`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 登录后进员工端 | 打开 `/employee` 并登录 | 空态「描述你的 IT 问题」；状态中文；带 `[Mock]` | Chrome CDP + 截图 `t002-empty.png` | pathname=`/employee`；空态 `[Mock] 描述你的 IT 问题`；状态 `[Mock] AI 接待中`；可点「转人工」；`conversation_id` 已写入 sessionStorage | PASS（Mock） |
| TC-01b | 含糊问法 | 发送「连不上」 | 反问气泡 + 可见改写 | Chrome CDP | 员工右气泡有「改写为：当前问法缺少系统或设备对象…」；左侧标签「反问」，不是兜底原文 | PASS（Mock） |
| TC-01c | 连续 6 次含糊 | 「连不上 / 怎么办 / 不行啊 / 没反应 / 打不开 / 还是不行」 | 第 1–5 次反问；第 6 次 PRD 兜底原文 | Chrome CDP + `t002-vague-fallback.png` | 前五轮标签均为「反问」；第 6 轮标签「兜底」，正文为固定句「抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。」 | PASS（Mock） |
| TC-02a | FAQ | 发送「Outlook 打不开」 | FAQ 气泡 | Chrome CDP + `t002-faq.png` | 标签「FAQ」；正文为 Outlook 安全模式/安装包修复；改写「Outlook 客户端无法启动的故障排查」 | PASS（Mock） |
| TC-02b | 闲聊 | 发送「你好」 | 闲聊气泡 | Chrome CDP + `t002-small-talk.png` | 标签「闲聊」；直接回复，不走知识分段 | PASS（Mock） |
| TC-02c | 知识分段 | 发送「VPN连不上而且打印机无法使用」 | 同一次知识回答内分段 | Chrome CDP + `t002-knowledge.png` | 一条「知识问答」气泡，含「1. VPN…」「2. 打印机…」 | PASS（Mock） |
| TC-02d | 超范围兜底 | 发送工单进度问法 | 同一固定兜底原文 | Chrome CDP + `t002-fallback.png` | 标签「兜底」；原文与 PRD 一致 | PASS（Mock） |
| TC-02e | 转人工后再发 | 点转人工，再发 FAQ 问法与「你好」 | 状态「已转人工，等待客服」；再发送只有员工气泡、无系统自动回 | Chrome CDP + `t002-after-handoff-send.png` | 状态变为该中文文案，按钮禁用为「已转人工」；系统气泡数保持 10，未见「已转交客服」占位，新员工消息无改写 | PASS（Mock） |
| TC-03a | 同标签页刷新 | `Page.reload` | 同一 `conversation_id`，仍已转人工 | Chrome CDP + `t002-reload.png` | id 仍为 `a14fd651-…`；状态仍「已转人工，等待客服」；消息 22 条仍在 | PASS（Mock） |
| TC-03b | UI-02 / 原型 02-employee | 计算样式 + 截图 | 员工右/系统左；输入钉底；状态中文业务名；`[Mock]`；数据在 `frontend/src/mocks/` | Chrome CDP | 员工 `align-self:flex-end`，气泡 `rgb(29,78,137)` 白字；系统左 `rgb(232,241,250)`；输入条 `min-height:88px`、`pinGap=0`、`flex-shrink:0`；消息区独立滚动（scrollHeight 1670 / 可视 688）；顶栏 56px；无 `small_talk` 等枚举泄漏；Mock 在 `frontend/src/mocks/conversations.ts` | PASS（Mock） |

## 未验 / 责任外

- 业务 AC-001、AC-002、AC-006、AC-007、AC-011～AC-016、AC-019～AC-022：T-012 关闭 Mock 后真实验收。
- 转人工后客服端可见与客服回复回写员工端：T-005 / T-013。
- 用户门禁预览端口 5175：T-005。
- 窄于 1024 布局：不在本任务 TC。

## 观察（不计入失败）

- 头less Chrome 截图的中文栅格化偏糊，判定以 CDP 读到的 DOM 文案为准。
- 转人工后 API Mock 仍可能写入 `waiting_for_agent`，页面已过滤，用户看不见系统自动回。
- 本轮全量 type-check 通过；即使后续被并行 T-003 挡住，也不应回记为本任务 FAIL。

## 经验候选

无。
