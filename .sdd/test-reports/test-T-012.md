# T-012 验收报告

- 任务：T-012 联调知识生效后的员工提问全链路
- 总结果：**PASS**
- 路径：真实后端 `http://127.0.0.1:8099` + 前端 `http://127.0.0.1:5199`，`VITE_USE_MOCK=false`，页面无 `[Mock]`
- 未改业务代码、未改 `tasks.json`、未杀 5199/8099、未写密钥、未开始 T-013/T-014

## 环境

| 项 | 实际 |
| --- | --- |
| 前端 | HTTP 200，`VITE_USE_MOCK=false`，`isMockEnabled()=false`，无 `[Mock]` |
| 后端 | HTTP 200 `/docs`；百炼 Chat/Embedding **已配置**（本任务最小次数：入库 1 篇账号文档 + 员工提问改写/分类/FAQ 向量/闲聊/知识生成） |
| 登录 | `it-help`（密码未写入本报告） |
| 浏览器 | 无头 Chrome + CDP 端口 **9395**，user-data-dir `t012-chrome-*`（未占用 9368/9357/9379/9383/9388，未用 t010/t011/t017 Chrome 目录） |
| 数据库 | 真实业务库；本轮只新增 `t012-oa-unlock.md`（account），未清库 |
| 兜底原文 | 与 `backend/.env` 的 `fallback_reply` **完全一致** |

会话：

- Conv A `a2bee8f1-0d62-441c-a0eb-1ee8cac112b0`：FAQ / 闲聊 / 知识 / 兜底 / 刷新续聊
- Conv B `e05c8bc6-f3aa-4eb6-a96e-11b3219578a2`：反问轮次、换题重置、第 6 次兜底、点一次转人工

## 逐 AC

| AC | 结果 | 实际 | 证据 |
| --- | --- | --- | --- |
| AC-001 | **PASS** | 未转人工。问 `T011HELIX-FAIL 认证失败是不是网卡硬件坏了` → 气泡「知识问答」，`kind=knowledge`，引用 Helix 分块（访客 WiFi / 证书 / 不是网卡硬件）。状态「AI 接待中」。 | `t012-browser-evidence.json` `steps.ac001`；截图 `t012-ac001-knowledge.png`；POST `/messages` 200 |
| AC-002 | **PASS** | Conv A 上反问、闲聊、FAQ、知识、三类兜底后 `status=bot`、转人工按钮仍可用。Conv B 点一次转人工 → `handed_off`、按钮禁用。未做客服接管全套（留给 T-013）。 | `ac002-no-auto-transfer-convA`；`steps.ac002transfer`；截图 `t012-ac002-transfer-click.png` |
| AC-011 | **PASS** | ① 原问「T011HELIX 重置 VPN 密码的要点是什么」→ `kind=faq`，答案为缓存 `T011HELIX-FAQ-NEW …`。② 上文 Helix 后短问「密码怎么重置」改写为「T011HELIX VPN 密码重置的操作要点是什么」仍 `kind=faq`。该轮无分块生成 Chat。 | `steps.ac011a` / `ac021`；截图 `t012-ac011-faq.png`；后端 20:04:08 仅 `chat/completions` + `embeddings` 后即 200 |
| AC-012 | **PASS** | 「你好呀，今天天气真好…不谈电脑」→ `kind=small_talk`，正文不依赖 T011WIFI/T012OA/T011HELIX 分块。 | `steps.ac012`；截图 `t012-ac012-smalltalk.png` |
| AC-013 | **PASS** | 两类对象：账号文档 `t012-oa-unlock.md`（`account`）对照网络 `t011-office-wifi.txt`（`network`）。账号问只含 `T012OA` / `T012OA-RESET-CODE`，不含 T011WIFI/微波炉。网络问含 T011WIFI/微波，不含 `T012OA-LOCK-MARKER`。 | `steps.ac013a` / `ac013b`；截图 `t012-ac013-network.png` |
| AC-014 | **PASS** | 食堂点餐（超范围）、工单 INC-991122 审批（实时工具）、量子传真机哈希（范围内无知识）三次回复均为固定兜底原文，`kind=fallback`，`status=bot`。 | `steps.ac014a/b/c`；截图 `t012-ac014-fallback.png` |
| AC-015 | **PASS** | 与 AC-014 同一批。回复不是工单查询结果。本窗口及整个后端日志中 httpx/百炼 `path` **只有** `.../chat/completions` 与 `.../embeddings`；全文无 ticket/工单工具 URL。 | `t012-backend-log-excerpt.txt`；后端 terminal `407193.txt` 20:05:24–20:05:39 |
| AC-016 | **PASS** | 一条消息两个 IT 问题 → **一条**「知识问答」气泡（otherDelta=1，system 9 条而非 10）。正文 `1）` WiFi/微波，`2）` T012OA 解锁码。脚本曾因正则不含全角 `）` 误标失败，以会话记录与截图为准。 | `steps.ac016`；截图 `t012-ac016-segments.png` |
| AC-019 | **PASS** | 新会话「连不上」→ `kind=clarification`，非兜底原文、非知识猜测；`original=连不上`，`rewritten` 写入会话；`clarification_round=1`。 | `steps.ac019`；截图 `t012-ac019-clarify.png` |
| AC-020 | **PASS** | 同一会话补全 T011WIFI + 微波炉 → `kind=knowledge`，命中办公网知识；`clarification_round=0`。 | `steps.ac020` |
| AC-021 | **PASS** | Helix 知识问答后短问「密码怎么重置」→ 改写含 T011HELIX VPN，走 FAQ 而非无对象兜底。 | checks `ac021-anaphora` |
| AC-022 | **PASS** | Conv B 连续 5 次含糊均为反问（round 1–5），第 6 次「还是不行啊」为兜底原文，`round=0`，不再第 6 次反问。 | `steps.ac022`；截图 `t012-ac022-sixth.png` |

## 技术检查

| ID | 结果 | 说明 |
| --- | --- | --- |
| TC-01 每条 AC 真实 HTTP/会话 | **PASS** | 浏览器 Network：POST `/api/conversations/{id}/messages` **21 次全部 HTTP 200**。各 AC 附 GET 会话快照（`status` / `kind` / `rewritten_content`）。未走 Mock。 |
| TC-02 FAQ 命中不走分块生成 | **PASS** | FAQ 轮次 `kind=faq` 且答案=缓存 FAQ。对照知识轮次（改写 Chat + 两次 Embedding + **第二次** Chat 生成）。FAQ 轮次 20:04:08 仅 Chat + Embedding 后返回，无 answer Chat。 |
| TC-03 标签过滤两类文档对照 | **PASS** | `account` vs `network` 提问互不引用对方独有标记。Helix 仍为 `hardware`，未清库。 |
| TC-04 AC-015 无工单工具；兜底=config | **PASS** | 百炼 path 仅 Completions/Embeddings。`fallback_reply` 与 PRD 原文一致。 |
| TC-05 刷新续聊 D-001 | **PASS** | 同标签页 reload 后 `conversation_id` 仍为 `a2bee8f1-…`，消息数 24→24，状态仍 AI 接待中。截图 `t012-d001-reload.png`。 |
| TC-06 换题重置 D-004 | **PASS** | Conv B 反问后改问问候 → `kind=small_talk`，`clarification_round=0`。随后 AC-022 新链路重新从 1 计到 5。脚本 `d004-two-unclear` 因刷新后 React 双挂载建了两个会话、第二条 UI 等待超时，属测试夹具，不否定产品重置行为。 |

## 脚本误报（不计入失败）

无头脚本 `failed=["tc-faq-no-chunk-gen","ac016-two-issues-one-reply","convB-new","d004-two-unclear"]`：

1. 日志切片用 `stat().size` 字节去 slice UTF-8 字符串，匹配为空；已改用后端 access/百炼 path 人工核对。
2. AC-016 分段号为 `1）`（全角括号），正则未覆盖；界面与 API 已是单条分段知识问答。
3. 清 `sessionStorage` 后 reload，StrictMode 连续 `POST /api/conversations` 两次（`cd33baef-…` 与 `e05c8bc6-…`），采集时 id 仍为 null。后续提问落在 `e05c8bc6-…`，与 Conv A 不同。

## 执行摘要

1. 派发检查 `gate_phase=passed`，`tester_ready=["T-012"]`，`execution_mode=automatic`。
2. 补入库账号 Markdown `t012-oa-unlock.md`（202 → ready，对象标签 `account`）。
3. `t012-browser.mjs`：关 Mock 登录员工端，按 AC 真实发送；百炼仅授权用途内最小次数。

## 范围外（不计入）

- 点转人工后客服列表/回复未验，属 T-013。
- 刷新后 React 可能双建会话：本任务 D-001 验证的是**不删** `conversation_id` 的同标签页刷新，已通过。

## 证据路径

目录：`Projects_Repo/Customer_Service/.sdd/test-reports/`

- 报告：`test-T-012.md`
- JSON：`t012-browser-evidence.json`
- 日志摘录：`t012-backend-log-excerpt.txt`
- 脚本：`t012-browser.mjs`
- 截图：`t012-login-employee.png`、`t012-ac019-clarify.png`、`t012-ac012-smalltalk.png`、`t012-ac011-faq.png`、`t012-ac001-knowledge.png`、`t012-ac013-network.png`、`t012-ac016-segments.png`、`t012-ac014-fallback.png`、`t012-d001-reload.png`、`t012-ac022-sixth.png`、`t012-ac002-transfer-click.png`
