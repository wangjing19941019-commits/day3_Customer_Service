# T-041 Tester 报告

- 任务：T-041 后端：EXT-004/005 联动、进度回写与工单进度问答
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-008`（REQ-011）
- 总结果：**PASS（后端阶段 / Mock）**
- 时间：2026-09-23
- 业务 AC 归 T-052，本任务不判真实页面联调

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- pytest 9.1.1 + pytest-timeout 2.4.0（`timeout: 120.0s` 已生效，插件已安装，method=thread）
- 工作目录：`Projects_Repo/Customer_Service`
- 仓库指纹：harness 根 `git rev-parse --short HEAD` = `ec75f8f`；项目 worktree 无提交；未执行 Git 写操作
- 改动指纹（SHA256）：
  - `warehouse.py` `770A804A5908FC8629EE916C6FF2F73444AD5288659DFD0CEA86379AE9C18B64`
  - `finance.py` `38D604F53165A4F897CAF6E990DDE98A7C32F0522EB8B3B88F09513AE8140F43`
  - `fulfillment.py` `B95A5D2004A2184A45E731A01A7393F915A228BCAE0475989F1B0A99FEC23A61`
  - `qa.py` `3DC30C1E55914FB46D60C624C97F8290CB21535C27533921B306CE62AA82222D`
  - `ticket.py` `344D106544DE95023F2F7CCFF63A3E51BDD56EEBFD5A0DBA58D75AF8CAE38E4E`
  - `conversation.py` `8ED3C7004C338767E5CC02D3812F28D85B4F315AE7EED31A290078628EF7EEBA`
  - `test_fulfillment.py` `0B85A3401F5956EC0101735FA6E4F209ECE22BB2C568B4E83EFBBA6B07937959`
  - `test_ticket_progress.py` `661441CD92FBA71B97062E2CB4FB4CA1580D6A0FC8A6A50AB93C191B7C0D963F`
- 未启动、未停止 8099；验收时本机 8099 无监听；未调用百炼；未读取或改写运行时业务库
- 测试库：pytest 用 `tmp_path/test.db`；路径不等于 `backend/data/Customer_Service.db`
- 运行时库指纹（验收后仍一致）：长度 622592 字节，LastWriteTime `2026-09-17 22:38:41`
- 报告不写口令、Token 或密钥
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git 写操作
- 仓储/财务适配器：`project.json` 为 fallback；空 `warehouse_base_url` / `finance_base_url` 走进程内 Mock（EXT-004/005）。用户已认可前端 Mock。本轮验证标注 **Mock**，不声称真实仓储/财务凭证或持久化联调已通过。

调度：`execution_mode=automatic`；`sdd_dispatch.py` 输出 `gate_phase=passed`（T-035）、`tester_ready` 含 `T-041`。本轮为编排器指定的在途验收，非 integration/delivery。依赖 T-037 / T-042 状态为 passed。后续业务验收责任任务为 T-052（AC-070、AC-071、AC-075）。

Developer `d9708ce6-9fd5-4e0f-b4b8-907fbc6b011b` 自称同命令 10 passed。Tester 独立重跑，**不以口头声明代替验证**。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 售后专员在岗；确认退换货；仓储 Mock `accepted=true` | POST API-015 | 工单进度含「已发起退货」；无「已生成退货单」「已开票」；仓储被调用 | pytest `test_return_accepted_writes_initiated_progress` | `fake_warehouse.calls` 非空；`progress.detail` 含「已发起退货」；dump 不含禁止文案 | PASS（Mock） |
| TC-02 | 仓储 Mock `accepted=false`，错误「仓储接口拒绝了退货申请」 | POST API-015 | 坐席可见失败说明；无「已发起退货」；无「已生成退货单」 | pytest `test_return_rejected_shows_failure_without_return_slip` | 响应含失败说明；details 无「已发起退货」；dump 无禁止文案 | PASS（Mock） |
| TC-03 | 确认开发票；财务 Mock `accepted=true` | POST API-015 | 进度含「已发起开票」；无「已开票」「已生成退货单」 | pytest `test_invoice_accepted_writes_initiated_progress` | `fake_finance.calls` 非空；details 含「已发起开票」；dump 无禁止文案 | PASS（Mock） |
| TC-04 | 财务 Mock `accepted=false`，错误「财务接口拒绝了开票申请」 | POST API-015 | 坐席可见失败说明；无「已发起开票」；无「已开票」 | pytest `test_invoice_rejected_shows_failure_without_invoiced` | 响应含失败说明；details 无「已发起开票」；dump 无禁止文案 | PASS（Mock） |
| TC-05 | 退换货确认成功 | 读原会话 messages / GET 会话 | 增加 `kind=ticket_progress`，内容与最新进度一致、用户可见 | pytest `test_confirm_writes_ticket_progress_to_original_session` | SQLite `messages.kind=ticket_progress`；GET 会话最后一条 progress `content=已发起退货`；无禁止文案 | PASS（Mock） |
| TC-06 | 已转人工且工单已有回写进度；员工问「我的退款到哪了」 | POST API-010 | `kind=ticket_progress`，内容与工单最新 progress 一致；不走 waiting | pytest `test_ask_refund_progress_returns_same_statement` | `reply.kind=ticket_progress`，`content=已发起退货`；不是「已转交客服，请等待回复。」；不含「到账」 | PASS（Mock） |
| TC-07 | 已转人工但无确认工单；问同一句 | POST API-010 | 不编造到账；固定「目前没有可查询的工单进度。」 | pytest `test_no_ticket_does_not_invent_arrival` | `kind=ticket_progress`，`content=目前没有可查询的工单进度。`；无「到账」/禁止文案 | PASS（Mock） |
| TC-08 | `warehouse_base_url=""` / `finance_base_url=""`，无 adapter override | 确认退换货 | 空地址走进程内 Mock；响应不写真实凭证 | pytest `test_empty_warehouse_url_uses_process_mock`；读 `get_warehouse_adapter` / `get_finance_adapter` | 空 URL 返回 Mock 适配器；进度「已发起退货」；dump 无 `sk-`、无 `Bearer ` | PASS（Mock） |

技术检查原文第 1 条由 TC-01～TC-05 覆盖；第 2 条由 TC-06～TC-08 覆盖。断言均为 pytest `assert`，失败会非零退出，不是只打印布尔值。

附加已跑、不单独计分：`test_address_change_does_not_call_warehouse_or_finance`（修改地址不调仓储/财务）；`test_duplicate_confirm_does_not_create_second_intent`（同 `ticket_id` 幂等，仓储只调用 1 次，progress 消息仍 1 条）。投诉/费用争议/物流异常与改地址走同一早退分支（`apply_after_confirm` 仅 `return_exchange`/`invoice` 才调适配器），technicalChecks 未要求单独 pytest。

## 实际执行

```
.\.venv\Scripts\python.exe -m pytest backend/tests/test_fulfillment.py backend/tests/test_ticket_progress.py --timeout=120 -v
```

- 退出码 0
- `collected 10 items`
- `====================== 10 passed, 106 warnings in 25.31s ======================`
- 仅跑上述两个文件；未跑 `test_tickets.py`
- 警告来自 Starlette/Pydantic deprecation 与 pycore `datetime.utcnow`，不计入本任务 FAIL

技术检查 1～2 均由上表覆盖，独立重跑与 Developer 自报命令一致且 10 passed。

## AC

本任务 `acceptanceCriteria=[]`。业务结果由 T-052 真实验收。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-070 | 不在本任务判定 | 退货/开票成功失败的页面可见结果归 T-052 |
| AC-071 | 不在本任务判定 | 坐席打开工单与原会话的用户可见进度归 T-052 |
| AC-075 | 不在本任务判定 | 原会话问退款进度的真实用户路径归 T-052 |

## 范围外

- 未对投诉/费用争议/物流异常各跑一次确认；代码早退与改地址单测已覆盖「本轮不发起仓储财务」，不计入本任务 FAIL。
- 未跑 HTTP 仓储/财务适配器（本轮 Base URL 为空，无真实凭证）。
- 未操作 8099，未用浏览器验收员工端/客服端。

## 结论

**PASS（后端阶段 / Mock）**。technicalChecks 全部通过；后续业务验收责任任务为 T-052。该 PASS 不证明完整业务功能或真实仓储/财务联调通过。
