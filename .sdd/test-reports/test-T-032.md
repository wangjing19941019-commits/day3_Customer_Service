# T-032 Tester 报告

- 任务：T-032 前端：员工端工单进度消息 Mock
- 总结果：**PASS（前端阶段 / Mock）**
- 时间：2026-09-23
- 模式：automatic；`sdd_dispatch.py` `gate_phase=frontend_in_progress`，`tester_ready` 含 T-032
- 本 PASS 不计 AC-071 / AC-075；真实仓储回写归 **T-052**
- 不代替 T-035 门禁；Tester PASS ≠ 用户放行
- 未改业务代码、未改 `.sdd/tasks.json`、未 Git

## 环境

| 项 | 值 |
| --- | --- |
| 预览 | http://127.0.0.1:5216/ |
| Mock | `VITE_USE_MOCK=true`（Vite 注入核对） |
| 账号 | it-help（口令不入报告） |
| 视口 | 1440×900 |
| 浏览器 | 独立 headless Chrome / CDP 9462，临时 user-data |
| 会话 | `fa5bea1c-f06b-4554-9ae1-dd2796f9fa78` |
| 动作 | 登录 → 转人工 → 点发送；有工单场景向 `sessionStorage.mock_tickets` 写入已确认退换货后等轮询 |

未占用/未结束 5175、8099、5288。

## 检查表

| ID | 场景 | 预期 | 方法 | 结果 |
| --- | --- | --- | --- | --- |
| TC-01 | 已转人工、无工单，问「我的退款到哪了」 | 左侧重试气泡，标签「进度说明」（非 `ticket_progress`）；正文「目前没有可查询的工单进度。」；带 `[Mock]`；不出现编造到账 | 点击发送 + 截图 | PASS |
| TC-02a | 同会话出现已确认退换货（订单 AP20260921011 / 连衣裙） | 原会话自动多一条含订单号、商品的进度说明；带 `[Mock]` | 写入 Mock 工单后等 GET 轮询 | PASS |
| TC-02b | 有回写后再问「我的退款到哪了」 | 回答与工单进度一致（订单号/商品/尚未到账），标签「进度说明」 | 点击发送 | PASS |
| TC-03 | 转人工后普通问题：怎么开发票、你好、这件连衣裙能退吗 | 无 FAQ / 闲聊 / 知识问答自动回；只追加员工气泡 | 点击发送 | PASS |
| TC-04 | 对照 UI-02 | 标签 12px / 18px / TextMuted `#5C6B7A`；系统气泡 `#E8F1FA`；左对齐；输入钉底 | 计算样式 + 截图 | PASS |

业务 AC：`acceptanceCriteria=[]`。关联 AC-071、AC-075 仅 Mock 覆盖，T-052 真实验收。

## 实际结果（脱敏）

1. 转人工后状态「已转人工，等待客服」，转人工按钮禁用。
2. 「怎么开发票」「你好」后 `otherCount=0`，页面无发票 FAQ 原文、无闲聊原文。
3. 「我的退款到哪了」（无工单）：标签「进度说明」，正文 `[Mock] 目前没有可查询的工单进度。`，无「已到账」。
4. 写入 `in_progress` + `return_exchange` 后轮询出现：`[Mock] 仓储已完成收货核验。订单 AP20260921011，连衣裙 的退货退款正在处理中，尚未到账。`
5. 再次询问，进度文案与上条一致。
6. 「这件连衣裙能退吗」未新增系统气泡，无「七天无理由」。

## 证据位置

- `Projects_Repo/Customer_Service/.sdd/test-reports/t032-browser-evidence.json`（`pass: true`, `failed: []`）
- `t032-ordinary.png` / `t032-no-ticket.png` / `t032-with-ticket.png` / `t032-ask-with-ticket.png`
- 脚本：`t032-browser.mjs`

## 范围外（不计入判定）

- `frontend/src/services/conversationService.ts` 的 `MessageKind` 尚未列入 `ticket_progress`（运行期靠 mock 转型）；用户可见标签来自 `types/conversation.ts` + `MessageBubble.tsx`。
- 真实 EXT-004/005 回写、关 Mock 联调：T-052。
- Developer 自报 Vite SSR 8/8：本轮以浏览器点击为准，未复跑该脚本。
