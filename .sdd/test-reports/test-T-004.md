# T-004 Tester 报告

- 时间：2026-09-13
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`13465659-5e0e-4080-824a-5cb1cb3131ae`
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-005
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验 technicalChecks。AC-005 / AC-006 / AC-008 由 T-013 承接，本轮不判业务 AC。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`
- 复用已在途本项目 Vite：`http://127.0.0.1:5199/`（进程 18672，`Projects_Repo\Customer_Service\frontend`）。Tester 未另起、未关闭。
- URL：`http://127.0.0.1:5199/agent`
- 账号：演示账号（密码未写入本报告）
- Mock：默认开（无 `frontend/.env`；`VITE_USE_MOCK` 未设为 false）；`VITE_POLL_INTERVAL_MS=3000` 见 `.env.example`
- 视口：1440×900，无头 Chrome + CDP（脚本 `.sdd/test-reports/t004-browser.mjs`）
- 质量：T-004 四文件 eslint 退出码 0；`tsc -p tsconfig.app.json --noEmit` 退出码 0（本轮未被并行文件挡住）
- 证据：`.sdd/test-reports/t004-browser-evidence.json`，截图 `t004-empty.png` / `t004-handed-off.png` / `t004-opened.png` / `t004-after-reply.png`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 刚进客服端，尚无 handed_off | 登录后点「客服端」立刻读页 | 左右见「还没有需要人工处理的对话」；回复框与「回复」禁用 | Chrome CDP + 截图 | pathname=`/agent`；空态文案×2；`rowCount=0`；textarea/按钮均 disabled；按钮文案「回复」 | PASS（Mock） |
| TC-02 | 约 3 秒拉取（D-003） | 等待列表行与改写出现 | 列表出现一条 handed_off；preview 含 Outlook/[Mock]；可打开完整对话含改写 | Chrome CDP + 截图 | 3113ms 后 1 行「[Mock] Outlook 打不开」+「已转人工」；详情含员工/反问/FAQ 及两处「改写为」 | PASS（Mock） |
| TC-03 | 发送客服回复 | 输入 UI-03 示例句并点「回复」 | 同一会话出现客服气泡 | Chrome CDP + 截图 | 标签「客服」，正文「[Mock] 已帮你报修，工单稍后代登」；仍 1 条会话 | PASS（Mock） |
| TC-04 | 未转接 bot 会话 | 全程读列表与正文 | VPN / bot 会话不得出现 | Chrome CDP | 空态、出列表、打开、回复后 `hasVpn=false`，始终 0 或 1 行 Outlook | PASS（Mock） |
| TC-05 | Mock 标识 | 读顶栏、列表、消息 | 界面 Mock 数据带 `[Mock]` | Chrome CDP | 顶栏「已登录：[Mock] it-help」；列表与气泡均含 `[Mock]` | PASS（Mock） |
| TC-06 | UI-03 / 原型 03-agent | 计算样式 + 截图 | 顶栏登录态与退出；左列 320px；列表两行；对话含改写；输入钉底；主色与字阶 | Chrome CDP + 截图 | 顶栏 56px；Canvas `rgb(244,246,248)`；左列 320px / 1px `#D9E2EC`；员工气泡 `rgb(29,78,137)`；系统/客服气泡 `rgb(232,241,250)`；输入条 min-height 88px；主按钮 40px「回复」 | PASS（Mock） |
| TC-07 | API-008/009/012 Mock 信封 | 读 `mocks/agentInbox.ts` + 页面结果 | 信封对齐 §二；列表仅 handed_off；详情含改写；回复 `role/kind=agent`；bot 回复 409 | 读代码 + 浏览器 | `buildEnvelope` 含 success/data/error/error_code/message/timestamp/request_id/metadata + pagination；`toListItem`/`toConversationPublic` 显式 DTO；未转接 `CONFLICT`；页面结果与之一致 | PASS（Mock） |
| TC-08 | 质量门（本任务路径） | eslint 四文件；`tsc -p tsconfig.app.json` | 定向通过；全仓若被并行挡住不记 T-004 FAIL | 命令 | eslint 0；本轮 app tsc 亦 0 | PASS |

## 未验 / 责任外

- 业务 AC-005 / AC-006 / AC-008：T-013 真实联调。
- 跨页员工端同一会话看见客服回复：T-005 / T-013，本轮不验。
- 窄于 1024 的客服左右改上下：不在本任务 TC。
- 用户门禁预览端口 5175：T-005。
- 关闭 Mock 后的真实 API-008/009/012。

## 观察（不计入失败）

- 出列表后页面自动选中第一条并拉详情，无需再点也能看到完整对话；本轮仍补点了列表行。
- 无草稿时「回复」仍 disabled（`!draft.trim()`），与空发送防护一致；空态时 textarea 一并禁用。
- 原型空态右侧文案为「从左侧选择已转人工的会话」，实现在无会话时左右均用「还没有需要人工处理的对话」，与 UI-03 / technicalChecks 一致。

## 经验候选

无。
