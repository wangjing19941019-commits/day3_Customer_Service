# T-052 Tester 报告（复验）

- 任务：T-052 联调：退货开票联动与用户可见进度
- 类型：integration；`source_feature=F-008`（REQ-011）
- 轮次：**复验**（上次总结果 FAIL：坐席打开工单看不到进度；列表无 id；GET `/api/tickets/{id}` 为 405）
- 总结果：**PASS**
- 时间：2026-09-23
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git、`experience.md`；未用 `Customer_Service.db`；未杀 8099 / 8110 / 5220 / 5175 / 5199

上次 FAIL 项仅复验 AC-070、AC-071，并抽查 AC-075 无回退。Developer `01109886-c0da-474b-90a3-03df679b4d0f` 声称列表带 id、新增 GET 返回 progress、工作台和管理端只读展示 detail。

## 环境与版本

| 项 | 值 |
| --- | --- |
| 前端 | http://127.0.0.1:5219/ ；`VITE_USE_MOCK=false`，代理 `VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8109`（原 5219 仍在，HMR 已吃到 TicketWorkbench / TicketListPage，未重启） |
| 后端 | 先停旧 8109 pid 27836，再用 `Temp\t052\serve.py` + `data/t052.db` 起新进程。本轮实测监听 pid=46748，cmdline 仍是该 serve.py |
| Mock | 仓储/财务 `*_base_url` 为空，进程内 Flag 适配器（任务允许）。页面无 `[Mock]` |
| 浏览器 | 独立 headless Chrome + CDP 9522；employee → agent → admin 真实点击 |
| 库隔离 | `Customer_Service.db` 仍 622592 字节、LastWriteTime `2026-09-17 22:38:41`；`t052.db` 由 245760 增至 274432、`2026-09-23 10:01:51` |
| 仓库指纹 | harness `git rev-parse --short HEAD` = `ec75f8f` |
| 调度 | `sdd_dispatch.py`：`execution_mode=automatic`，`gate_phase=passed`（T-035），`tester_ready` 含 T-052 |
| pytest | `backend/tests/test_ticket_queue.py --timeout=60` → **10 passed**（含 GET 返回 progress） |
| GET 抽检 | 未登录 GET `/api/tickets/missing-ticket-id` → **401**（不再是 405）；OpenAPI 含 GET `/api/tickets/{ticket_id}` |

保护端口本轮前后均为：8110=50404、5220=40368、5175=18252、5199=17012、5219=45976。8099 开始前已无监听，Tester 未启动也未杀。口令不入报告。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| AC-070-return-ok | 确认退换货，仓储 Flag=接受 | 坐席点确认工单 | 工作台能看到已经发起退货；无「已生成退货单」 | 5219 点击 + 工作台 DOM | `TKT-20260923-0010`；工作台 `进度 … 已发起退货`；JSON `detail=已发起退货`；无禁止文案 | **PASS** |
| AC-070-return-fail | 仓储 Flag=拒绝 | 再确认一张退换货 | 坐席工作台看到失败说明，无「已生成退货单」 | 同上 | 工作台 `进度 … 仓储接口拒绝了退货申请`；无「已生成退货单」「已开票」 | **PASS** |
| AC-070-invoice-ok | 确认开发票，财务 Flag=接受 | 坐席点确认 | 工作台能看到已经发起开票；无「已开票」 | 同上 | 工作台 `进度 … 已发起开票`；无单独「已开票」 | **PASS** |
| AC-070-invoice-fail | 财务 Flag=拒绝 | 再确认一张开发票 | 工作台看到失败说明，无「已开票」 | 同上 | 工作台 `进度 … 财务接口拒绝了开票申请`；无禁止文案 | **PASS** |
| AC-071-open-ticket | 回写后打开该工单 | 工作台 + 管理端点 TKT-20260923-0010 行 | 打开工单能看到新进度；列表有 id；GET 200 | 5219 `/agent` 与 `/tickets` 点击 | 工作台有进度。列表 keys 含 `id`。GET `/api/tickets/{id}` **200**，`details=["已发起退货"]`。管理端「只读进度」同句 | **PASS** |
| AC-071-session | 回写后打开原会话 | 员工端看气泡 | 用户能读到的进度说明 | 5219 `/employee` | 标签「进度说明」，正文「已发起退货」/「已发起开票」 | **PASS** |
| AC-075-with | 已有回写进度，问「我的退款到哪了」 | 原会话发送 | 回答与工单最新进度一致，不进 FAQ/AI | 点击发送 | 「进度说明 / 已发起退货」，与 JSON 最新 `detail` 一致；无 FAQ/知识 | **PASS** |
| AC-075-none | 无确认工单，已转人工再问同一句 | 新会话发送 | 不编造到账 | 点击发送 | 「进度说明 / 目前没有可查询的工单进度。」无「到账」 | **PASS** |
| TC-no-mock | 真实联调页 | 登录三端 | 前端无 `[Mock]` | 页文案 | employee/agent/admin/工单列表均无 | **PASS** |
| TC-no-faq | 已转人工问进度 | 发送 | 不进 FAQ/AI | 气泡 kind | 有工单/无工单均为 `进度说明` | **PASS** |

## AC 判定（复验）

| AC | 上次 | 本轮 | 说明 |
| --- | --- | --- | --- |
| AC-070 | FAIL | **PASS** | 退货/开票成功失败均写在客服工作台「进度」区；失败文案无「已生成退货单」「已开票」。截图视口常裁在字段区下方，判定以 `.agent-work` innerText 为准。 |
| AC-071 | FAIL | **PASS** | 工作台能看到新进度；管理端点 `TKT-20260923-0010` 行「只读进度」同为「已发起退货」；原会话仍有进度说明。列表带 `id`；GET 由 405 变为 200。 |
| AC-075 | PASS | **PASS**（抽查无回退） | 有工单问进度与最新 `detail` 一致；无工单固定「目前没有可查询的工单进度。」不编造到账。 |

## 上次缺陷是否还在

1. **坐席打开工单看不到进度** → 已修复。工作台 DOM：`进度 2026-09-23T02:00:48… 已发起退货`（失败为接口拒绝说明）。
2. **列表无 id** → 已修复。`GET /api/tickets` 首条 keys 含 `id`，匹配 `TKT-20260923-0010`。
3. **GET /api/tickets/{id} 405** → 已修复。本轮 **200**，`progress.detail=已发起退货`。未登录抽检为 401，不再 405。

## 经验候选核对（Tester 不落盘）

| 项 | 结论 |
| --- | --- |
| 已验证修复 | 列表 `TicketListItem.id`；`GET /api/tickets/{id}` 返回 `TicketPublic.progress`；工作台与管理端只读展示 `detail`。停掉旧 8109 后 OpenAPI 才出现 GET。 |
| 已验证现象 | 旧 uvicorn 继续跑则联调页仍 405/无进度；与 Developer 自验 pytest 10 passed 并不矛盾。 |
| 推测根因 | 路由原先缺 GET；列表模型缺 id；工作台未渲染 `ticket.progress`。功能 PASS 支持该修复路径，未再对照旧二进制。 |
| 适用边界 | 本项目 FastAPI `/api/tickets` 队列 + 5219 真实前端；仓储/财务仍是空地址 Flag 适配器，不证明真实外部凭证。 |
| 建议 | 可沉淀「隔离 uvicorn 必须重启后才能验收新路由」；Tester 不写 `experience.md`。 |

## 证据位置

- 本文件：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service\.sdd\test-reports\test-T-052.md`
- JSON：`.sdd/test-reports/t052-browser-evidence.json`（`pass=true`，`failed=[]`，17 checks）
- 截图：`t052-return-ok-agent.png`、`t052-return-ok-employee.png`、`t052-ask-with-ticket.png`、`t052-return-fail-agent.png`、`t052-invoice-ok-agent.png`、`t052-invoice-fail-agent.png`、`t052-ask-no-ticket.png`、`t052-tickets-list.png`

## 范围外

- 仓储/财务为空地址进程内 Mock，任务允许；不声称真实仓储/财务凭证已联调。
- 工作台进度时间戳为 ISO，管理端为本地时间；AC 未要求格式一致。
- 未改业务代码。填单仍用页面 PATCH 补全字段后再点「确认工单」，确认点击与后续观察在 5219 真实 UI。
