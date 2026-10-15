# T-031 Tester 报告

- 时间：2026-09-23
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`623b66f3-d6e2-4aa9-8602-651815d5c7d1`
- Tester：本轮编排器派发的 Tester
- 模式：automatic；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`，`gate_task_id=T-035`，`tester_ready` 含 `T-031`
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks` 的 Mock 行为。关联业务 AC-030～047、057、058、062、083 由联调 **T-026 / T-046 / T-047** 关 Mock 真实验收。本 PASS 不计业务 AC，不代替 T-035 门禁，不等于用户已放行。
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git、`experience.md`。

## 环境

- 工作目录：`frontend/`；Tester 自起预览 `http://127.0.0.1:5291/`（`$env:VITE_USE_MOCK='true'; npx vite --host 127.0.0.1 --port 5291 --strictPort`，HTTP 200）。未占用/未关闭 5175、8099、5288、5216。
- Mock：浏览器 JS；未把真实 `/api` 当证据。未调用付费 LLM。
- 账号：员工 `it-help` → 转人工后客服 `agent`（口令未写入本报告）
- 视口：1440×900；窄屏复核 390×844。无头 Chrome 153.0.8010.48 + CDP **9462**；独立 `user-data-dir` `t031-chrome-*`
- 指纹（SHA256 前 16 位）：
  - `AgentInboxPage.tsx` `80683BFB6A0947FF`
  - `TicketWorkbench.tsx` `174BC97ABD3B7A48`
  - `PolishCompare.tsx` `643AD598F0A0D313`
  - `KnowledgePanel.tsx` `FD590F675BD39D5A`
  - `agentWorkbench.css` `6D9A27EAAF6476FD`
  - `useAgentInbox.ts` `93ECC8A45BBE4E99`
  - `useTicket.ts` `46E7B6A386688FC0`
  - `ticketService.ts` `5F8C84587D80738E`
  - `agentKnowledgeService.ts` `8C6A8EC56C1A325F`
  - `polishService.ts` `37565E7C72A6A25C`
  - `mocks/agentInbox.ts` `6580F350C986A2EB`
  - `mocks/tickets.ts` `C07374E24E576923`
  - `types/ticket.ts` `4117AF0219B182AB`
- 质量抽检：`npx eslint` 针对本任务 write_scope ts/tsx 退出码 0。Developer 自验 type-check / lint / build 通过；本轮未因版本变化重跑全量 `tsc`/`build`。
- 证据：`.sdd/test-reports/t031-browser-evidence.json`、脚本 `t031-browser.mjs`、截图 `t031-*.png`
- 验收后已关掉本轮 Chrome/CDP；5291 仍在（本轮 Tester 预览，未关 5175/8099/5288/5216）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 六类字段键 | 已转接工作台切换退换货 / 修改地址 / 开发票 / 投诉维权 / 费用争议 / 物流异常 | 字段键与契约一致；带 `[Mock]` | Chrome 点选 + DOM | 六类 `ids` 与 `TYPE_KEYS` 完全一致；类型下拉含这六项 | PASS（Mock） |
| TC-01b | 未选类型或业务线 | 售前空类型；有类型无业务线 | 确认禁用 | DOM `confirmDisabled` | 两态均为 `true` | PASS（Mock） |
| TC-01c | 四态颜色 | 已填 / 待确认 / 缺失 / 冲突 | Success 绿 / Warning 黄 / Danger 红；中文标签 | 计算样式 + 截图 | 已填 `rgb(15, 123, 90)`=`#0F7B5A`；待确认 `rgb(180, 83, 9)`=`#B45309`；缺失与冲突 `rgb(180, 35, 24)`=`#B42318` | PASS（Mock） |
| TC-01d | 一条订单 | 转人工后说昨天蓝色手机（无「两笔」），选退换货+3C | 订单号自动填一条 | 点击 + `t031-one-order.png` | 订单号 `JD20260922001`、状态「已填」、无候选按钮 | PASS（Mock） |
| TC-01e | 两笔蓝色手机 | 新会话说「昨天有两笔蓝色手机要退」 | 只列候选且不预选 | 点击 + `t031-two-orders.png` | 订单号空、「待确认」；两条候选 JD20260922001 / JD20260922002，`aria-pressed=false` | PASS（Mock） |
| TC-01f | 零条 | 「紫色冰箱查不到订单」 | 缺失、不编造单号、暂未查到 | 点击 + `t031-zero-order.png` | 订单号空、「缺失」；输入不含 JD/AP；提示「暂未查到」 | PASS（Mock） |
| TC-02a | 99 后再说 88 | 同草稿先 99 元再 88 元 | 仍显示 99 并标冲突 | 点击 + `t031-amount-conflict.png` | 金额值 `99`、状态「冲突」、文案「原值 99，新值 88」 | PASS（Mock） |
| TC-02b | 费用争议截图 | 无图点确认；补 PNG 后再确认 | 无图不能确认；补图后可确认 | 点击上传 + DOM | 无图：确认禁用且挡「证据截图」；补图后 `confirmDisabled=false`，点确认后按钮「已确认」、类型 disabled | PASS（Mock） |
| TC-02c | 润色通过 | 输入「你这个退不了，超时间了」 | 对比原稿/润色稿；保留会话时效 7 天；有采用/修改/放弃 | 点击 + `t031-polish-compare.png` | 对照区可见；润色稿含「超过 7 天」；三按钮都在 | PASS（Mock） |
| TC-02d | 润色不合规 | 「一定全额退，赔500元」 | 不能直接采用 | 点击 + `t031-polish-risk.png` | 无「采用」；Danger 红字「合规未通过，不能直接采用润色稿」 | PASS（Mock） |
| TC-02e | 放弃后发送原稿 | 通过润色后点放弃再发送 | 员工端看到原稿 | 切回员工端 | 员工页含「你这个退不了，超时间了」；放弃后输入区仍是原稿 | PASS（Mock） |
| TC-02f | 当次反馈 | 提交无用反馈 | 可提交；无保存模板入口 | DOM + 截图 | 文案「当次结果反馈，不会保存为模板」；提交后「已提交反馈」；全文无「保存模板」 | PASS（Mock） |
| TC-03a | 未转接 | 客服账号打开空收件箱 | 无填单区 | `t031-empty-agent.png` | 「还没有需要人工处理的对话」；无工单下拉 | PASS（Mock） |
| TC-03b | 窄屏 | 390×844 | 工作台在对话下方 | 布局几何 + `t031-narrow.png` | `flex-direction=column`；工作台 `y` 在对话列底部之下 | PASS（Mock） |
| TC-03c | 知识不进发送 | 推送区有卡片时看输入框 | 不得把知识正文自动填入发送 | DOM | `agent-reply` 为空；无「发给用户」按钮 | PASS（Mock） |
| AC-030～047 等 | 真实联调 | 本任务不验 | 归 T-026/T-046/T-047 | 契约 | 未关 Mock | 不计入；后续任务 |

## 经验候选核对（只报告，不写 experience.md）

1. **无「两笔」时只自动填一条，避免关键词重叠误成多条。**  
   **已验证。** 适用边界：前端 Mock 订单匹配（`mocks/tickets.ts` `matchOrders`）。无「两笔/两条」且「蓝色+手机」可命中两笔种子单时，只自动填 `JD20260922001`；出现「两笔蓝色手机」才列出两候选且不预选。证据：`t031-one-order.png` / `t031-two-orders.png`。未验证真实订单中心。

2. **润色稿须保留会话里的时效数字，避免「超时间了」被判成改了时效。**  
   **已验证（「超时间了」路径）。** 会话已有「超过7天」，润色「你这个退不了，超时间了」仍写出「超过 7 天」且可采用。证据：`t031-polish-compare.png`。  
   同会话再润色「一定全额退，赔500元」时，因不合规早退未带回「7天」，界面额外标了「改变了时效」——这不否定第 2 条对「超时间了」路径的必要性，也不推翻「不能直接采用」。

## 未验 / 责任外

- 业务 AC-030～047、057、058、062、083：关闭 Mock 后由 **T-026 / T-046 / T-047** 真实验收。
- 用户门禁：唯一 `user_gate` 在 **T-035**。本 PASS 不放行门禁。
- 真实 API-012～019、关 Mock、5175 用户验收端口：本轮未启。

## 观察（不计入失败）

- 转人工前的反问示例句含「连衣裙」。抽取用全会话语料，商品信息常被填成「连衣裙」，即使用户后来说的是蓝色手机。本任务 TC 验收的是订单号自动填/候选/零条，订单号行为正确。不把商品串词记为本轮 FAIL。
- 界面 Mock 数据带 `[Mock]`。确认工单在右列、发送在输入区，未并排两个同级主按钮。

## 门禁提示（交编排器）

本任务不是 T-035。Tester PASS ≠ 用户已放行。不要开始 T-026/T-046/T-047 当真验收。

可复用预览（Mock）：

```
http://127.0.0.1:5291/
```

员工用户名 `it-help`，客服用户名 `agent`。若 5291 已不在：`cd frontend` 后 `$env:VITE_USE_MOCK='true'; npx vite --host 127.0.0.1 --port <空闲端口> --strictPort`，避开 5175/8099/5288/5216。
