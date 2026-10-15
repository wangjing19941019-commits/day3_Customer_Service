# T-005 Tester 报告

- 时间：2026-09-13
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`239c9854-4f94-48af-94c7-bb1161c1448d`
- 模式：automatic；`gate_phase=frontend_in_progress`，`user_gate.status=pending`（本 PASS 后由编排器改 `awaiting_user`）
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验 `technicalChecks`。后续业务 AC：T-010（AC-009/010/025/026）、T-011（AC-003/004/017/018/023/024）、T-012（REQ-001 全套）、T-013（AC-005～008）。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`
- 指纹：Harness HEAD `ec75f8f`；无 `frontend/.env`，`VITE_USE_MOCK` 未关，默认 Mock
- 服务：复用已在监听的本项目 Vite（PID 18672，`Customer_Service/frontend` 的 `vite --host 127.0.0.1 --port 5199`，HTTP 200）。Tester 未另起、未关闭。
- URL：http://127.0.0.1:5199/
- 账号：演示用户名 `it-help`（报告不写密码）
- 拉取间隔：`getPollIntervalMs` 默认 3000；`.env.example` 中 `VITE_POLL_INTERVAL_MS=3000`
- 视口：1440×900 与 900×900；无头 Chrome + CDP 9335（独立 `user-data-dir`）
- 质量：本轮 `npm run type-check` / `lint` / `build` 均为退出码 0（Vite 8.3.0，109 modules）
- 证据：`.sdd/test-reports/t005-browser-evidence.json`、脚本 `t005-browser.mjs`、截图 `t005-*.png`
- 验收后：已关掉本轮 Chrome/CDP；5199 仍在（他方进程）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 错密码 | 登录页提交错误密码 | 留在本页，失败说明带 `[Mock]` | Chrome CDP + `t005-wrong-password.png` | pathname=`/login`；`[Mock] 用户名或密码错误`；无 token | PASS（Mock） |
| TC-01b | 正确登录后三页顶栏 | 登录后分别打开员工/客服/知识库 | 顶栏「已登录：[Mock] it-help」+「退出」一致 | Chrome CDP | 三页均为该文案；`aria-current=page` 各仅一项 | PASS（Mock） |
| TC-01c | 导航互斥 | 点三项侧栏 | NavLink `end` 互斥，非当前页不占内容 | Chrome CDP | 每页 `activeCount=1`，员工/客服/知识库分别选中 | PASS（Mock） |
| TC-01d | 客服端不再定时演示 | 登录后立刻进客服端并等 >3s | 空态，不出现 Outlook 演示会话 | Chrome CDP + `t005-agent-empty.png` | 等 3672ms 仍 0 行；空态「还没有需要人工处理的对话」×2 | PASS（Mock） |
| TC-02a | 非 md | 选 `notes.txt` 点上传 | 立刻「请重新上传」，列表不新增该文件 | Chrome CDP + `t005-non-md.png` | 文案 `[Mock] 请重新上传`；行数 1→1，仅种子 `vpn-faq.md` | PASS（Mock） |
| TC-02b | md 入库中 | 上传 `t005-crosspage.md` | 立刻「入库中」；无分块、无标签/FAQ 编辑 | Chrome CDP + `t005-ingesting.png` | 列表「入库中」；`hasChunks=false`，`hasEditForm=false` | PASS（Mock） |
| TC-02c | 进行中离开再回 | 切员工端再回知识库 | 仍进行中，仍不可编辑 | Chrome CDP + `t005-ingesting-back.png` | 39ms 内仍「入库中」；无分块/编辑表 | PASS（Mock） |
| TC-02d | 完成后只读分块 | 等 ready 打开该文档 | 多块只读，无保存分块入口 | Chrome CDP + `t005-ready.png` | 「已完成 · 3 块」；块无 input / contenteditable | PASS（Mock） |
| TC-03a | 员工各分支后转人工 | 反问 / FAQ / 闲聊 / 知识分段 / 兜底后点转人工，再发 | 再发无系统自动回 | Chrome CDP + `t005-after-handoff.png` | 标签分别为反问/FAQ/闲聊/知识问答/兜底；转后 `otherCount` 5→5 | PASS（Mock） |
| TC-03b | 客服端出现该会话 | 转人工后进客服端 | 出现**该会话**（含改写），不是定时演示会话 | Chrome CDP + `t005-agent-same-session.png` | 1 行预览「[Mock] 转人工后再问 Outlook 打不开」；详情含「改写为」；会话 id `b6cca0b4-…` | PASS（Mock） |
| TC-03c | 客服回复回到员工端 | 客服发送后回员工端 | 约 3s 内出现客服气泡 | Chrome CDP + `t005-employee-sees-reply.png` | 共用 `sessionStorage mock_conversations`，切回 2ms 内见「[Mock] 已帮你报修，工单稍后代登」 | PASS（Mock） |
| TC-04a | 1440 布局 | 视口 1440×900 | 侧栏竖排 220px；输入钉底；长消息不遮顶栏 | Chrome CDP + `t005-layout-1440.png` | 侧栏 `column`/220；`pinGap=0`；顶栏 56px 且 `messagesCoversTopbar=false` | PASS（Mock） |
| TC-04b | 窄于 1024 | 视口 900×900 | 侧栏横排 48px；输入仍钉底；长消息不遮顶栏 | Chrome CDP + `t005-layout-900-*.png` | 三业务页侧栏 `row`/高 48；员工端 `pinGap=0`；顶栏仍 56px 未遮 | PASS（Mock） |
| TC-05a | `[Mock]` | 扫登录失败、顶栏、列表、气泡 | 界面 Mock 数据带 `[Mock]` | Chrome CDP | 失败文案、顶栏用户名、知识文件名、员工/客服气泡均含 `[Mock]` | PASS（Mock） |
| TC-05b | 信封 §二 | 读 `frontend/src/mocks/` | 对齐 pycore 信封 | 读代码 | `okEnvelope`/`buildEnvelope` 含 success/data/error/error_code/message/timestamp/request_id/metadata；列表另含 pagination；conversations 与 agentInbox 共用 `conversationStore.ts` | PASS（Mock） |
| TC-06 | 质量门 | type-check / lint / build | 三项通过 | 本轮命令 | 三命令退出码 0 | PASS |

## 未验 / 责任外

- 业务 AC 全部由 T-010～T-013 在关闭 Mock 后真实验收，本轮不判。
- 用户门禁预览端口 5175 / 后端 8003：本轮未启；Agent 预览为 http://127.0.0.1:5199/ 。
- 关闭 Mock 后的真实登录、入库、提问、转人工。
- `user_gate` 仍 pending，Tester 不改门禁。

## 观察（不计入失败）

- 首轮 `nonMdImmediate` 曾因知识列表尚未刷出种子行（0→1）误判；证据已显示 `notes.txt` 未入库。定向复测等待列表后再传，行数 1→1。产品行为未变。
- 客服回复在切回员工端时已在共用存储中，故 `pollMs=2`，仍满足「约 3 秒内」。
- 客服详情在转接后可见标签「等待客服」（内部 `waiting_for_agent` 的中文名），未见 `fallback` / `handed_off` 枚举泄漏。
- T-003 入库细节（fail.md、改标签保存）本轮未重跑，沿用其稳定 PASS；本轮补了跨页离开再回与四页收口。
- 登录页仍展示演示账号（与原型一致）。

## 门禁提示（交编排器）

需交用户验收 Mock，并在 `backend/.env` 填写百炼等配置后再放行联调。可复用启动：`cd frontend && npm run dev -- --host 127.0.0.1 --port 5199`。用户门禁验收端口约定为 5175。Tester PASS ≠ 用户已放行。

## 经验候选

无。
