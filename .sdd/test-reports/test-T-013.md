# T-013 验收报告

- 任务：T-013 联调转人工后客服接管与员工等待
- 总结果：**PASS**
- 路径：真实后端 `http://127.0.0.1:8099` + 前端 `http://127.0.0.1:5199`，`VITE_USE_MOCK=false`，页面无 `[Mock]`
- 未改业务代码、未改 `tasks.json`、未杀 5199/8099、未写密钥、未开始 T-014

## 环境

| 项 | 实际 |
| --- | --- |
| 前端 | HTTP 200，`VITE_USE_MOCK=false`，无 `[Mock]` |
| 后端 | HTTP 200 `/docs`；百炼 Chat **已配置**（本任务仅 AC-007 与转接前 FAQ 各 1 次 Completions；转接后提问 0 次） |
| 登录 | `it-help`（密码未写入本报告） |
| 浏览器 | 无头 Chrome + CDP **9413** / 复测 **9415**，user-data-dir `t013-chrome-*`（未占用 9395/9368/9357/9379/9383/9388，未用 t010/t011/t012/t017 Chrome 目录） |
| 派发 | `sdd_dispatch.py`：`gate_phase=passed`，`tester_ready=["T-013"]`，`execution_mode=automatic` |

会话（均为新会话，未沿用 T-012 Conv B `e05c8bc6-…`）：

- Conv A `b68e4e94-5a53-4ae7-b25a-8e8d13527bc0`：转接前 FAQ + 点转人工 + 客服接管 + 转接后再问
- Conv B `ad1eaa4e-df21-42a4-8ea2-66a73529e471`：仅文字「转人工」，未点按钮

## 逐 AC

| AC | 结果 | 实际 | 证据 |
| --- | --- | --- | --- |
| AC-005 | **PASS** | 员工点转人工后 `status=handed_off`，状态条「已转人工，等待客服」，按钮禁用。客服端打开该会话可见转接前员工原问、改写「T011HELIX 重置 VPN 密码的要点是什么」及 FAQ 回复。客服发送 `T013-AGENT-1…` 后，员工同一会话出现「客服」气泡。 | `t013-browser-evidence.json` `steps.transfer` / `agentOpen` / `employeeSeesR1`；截图 `t013-ac005-employee-after-transfer.png`、`t013-ac005-agent-inbox.png`、`t013-ac005-employee-sees-reply.png` |
| AC-006 | **PASS** | 已转人工后再发闲聊 `T013-POST-HANDOFF-CHAT…`：`kind=waiting_for_agent`，UI 无新 FAQ/闲聊/知识气泡，百炼 Completions=0。定向复测再发缓存 FAQ `T013-RETRY-FAQ T011HELIX…`：`afterKinds=["employee:employee_turn","system:waiting_for_agent"]`，otherDelta=0，Completions=0；客服端可见该员工句，其后不是 FAQ 自动答，而是「等待客服」。直至客服回复前保持等待。 | 首轮 `steps.ac006chat`；复测 `t013-retest-ac006-evidence.json` `steps.faq`；截图 `t013-ac006-waiting.png`、`t013-ac006-retry-faq.png`、`t013-ac006-retry-agent.png` |
| AC-007 | **PASS** | 新会话未点按钮，消息「请帮我转人工，不要点按钮。」→ 仍走 REQ-001：`status=bot`，`kind=fallback` 固定兜底，状态「AI 接待中」，转人工按钮仍可点。客服列表不含该会话。最小次数百炼 Chat 1 次 + Embedding 1 次。 | `steps.ac007`；截图 `t013-ac007-text-transfer.png` |
| AC-008 | **PASS** | 未转人工（Conv A 转接前、Conv B 全程）不出现接管结果：状态不是「已转人工，等待客服」，`kind≠waiting_for_agent`。对 bot 会话调 API-012 → HTTP 409 `CONFLICT`「会话尚未转人工，无法以客服身份回复」，status 仍为 `bot`。 | `steps.api012onBot` / `api012onText` / `listAfterText`；截图 `t013-ac008-agent-list.png` |

## 技术检查

| ID | 结果 | 说明 |
| --- | --- | --- |
| TC-01 API-008 仅 handed_off | **PASS** | 转接前列表仅 T-012 Conv B，`status=handed_off`，不含 Conv A。转接后列表 2 条均为 `handed_off` 且含 Conv A。文字转人工的 Conv B 始终不在列表。无 `bot` 项。 |
| TC-02 客服回复约 3 秒内到员工端（D-003） | **PASS** | 员工页保持打开时 API-012 发送 `T013-AGENT-2…`，员工 UI **2864ms** 出现「客服」气泡（`poll_interval_ms=3000`）。首条回复由客服端按钮发出，员工同一会话可见。 |
| TC-03 已转接后再问不产生 FAQ/AI kind | **PASS** | 闲聊后 `system:waiting_for_agent`。FAQ 复测后 kinds 仅为 `employee_turn` + `waiting_for_agent`，无 faq/small_talk/knowledge/clarification/fallback。窗口内无 `chat/completions`。 |
| TC-04 仅文字「转人工」不改 status | **PASS** | Conv B `status=bot`；`rewritten_content` 仍为原句；未调 API-011。 |
| TC-05 未转接不能被 API-012 接管 | **PASS** | Conv A 转接前与 Conv B 两次 POST `/replies` 均为 409 CONFLICT。 |
| TC-06 对照 UI-02 / UI-03 | **PASS** | 员工端：顶栏「智能客服 / 员工端」、已登录用户名、状态条、消息滚动、输入钉底（composerBottom=900）、员工气泡白字+主色 `rgb(29, 78, 137)`、画布 `rgb(244, 246, 248)`。客服端：左列 320px、行上摘要+时间+「已转人工」、右侧完整链路含改写、主按钮「回复」；无会话文案与原型一致。无 `[Mock]`。 |

## 脚本误报（不计入失败）

首轮 `t013-browser.mjs` 打印 `failed=["d001-same-session-after-nav","ac006-faq-no-ai","ac006-agent-sees-waiting-not-faq"]`：

1. `d001-same-session-after-nav`：会话 ID 实际相等；从客服端切回员工端时未等状态条渲染完就断言。随后 `employeeSeesR1` 已是同一 Conv A 且「已转人工，等待客服」。
2. `ac006-faq-no-ai`：切页后输入框仍 disabled，20s 内未发出 FAQ。产品未收到该句。闲聊句已按 AC-006 通过。
3. 定向复测 FAQ（CDP 9415）产品路径全部符合 AC-006；复测脚本因断言误用 `last.otherDelta !== undefined` 打出 FAIL，但 JSON 证据 `afterKinds`、`otherDelta=0`、Completions=0、客服端无 FAQ 自动回均为通过。

## 执行摘要

1. 派发检查允许 Tester；write_scope 为空，未改业务代码。
2. 新会话 Conv A 走真实 API-010/011/008/009/012；Conv B 验文字转人工仍走 REQ-001。
3. 百炼仅授权用途内最小次数：转接前 1 次 FAQ 改写检索 + AC-007 1 次改写检索。转接后提问未打 Chat。

## 范围外（不计入）

- 未开始 T-014。
- T-012 Conv B 仍在客服列表中，属既有已转接会话，未当作本轮 bot 会话。

## 证据路径

目录：`Projects_Repo/Customer_Service/.sdd/test-reports/`

- 报告：`test-T-013.md`
- JSON：`t013-browser-evidence.json`、`t013-retest-ac006-evidence.json`
- 脚本：`t013-browser.mjs`、`t013-retest-ac006.mjs`
- 截图：`t013-login-employee.png`、`t013-ac005-employee-before-transfer.png`、`t013-ac005-employee-after-transfer.png`、`t013-ac005-agent-inbox.png`、`t013-ac005-agent-replied.png`、`t013-ac005-employee-sees-reply.png`、`t013-ac006-waiting.png`、`t013-ac006-retry-faq.png`、`t013-ac006-retry-agent.png`、`t013-ac007-text-transfer.png`、`t013-ac008-agent-list.png`
