# T-042 Tester 报告

- 任务：T-042 后端：确认后分配、紧急程度、认领、SLA 与 EXT-006
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-007`（REQ-010）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 业务 AC 归 T-050 / T-051，本任务不判真实页面联调

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- pytest 9.1.1 + pytest-timeout 2.4.0（`timeout: 120.0s` 已生效，插件已安装，method=thread）
- 工作目录：`Projects_Repo/Customer_Service`
- 仓库指纹：harness 根 `git rev-parse --short HEAD` = `ec75f8f`；未执行 Git 写操作
- 改动指纹（SHA256）：
  - `ticket_queue.py` `6DF834DAE483B217FDF6BC933905EEC5F7AF510ACA3367F77A1B6FCABC6FE295`
  - `assign.py` `F0BE3503C2492B6D2AAE03C31F47FAC38897759BAACD424032A25E6E2BB1599D`
  - `sla.py` `1D43EF9DFFDC92792B8C507D4F86CD942657FFDD17ADA3D2BFCF4871FE1FEF0A`
  - `member.py` `6A0248298C424C26B0EAE069847C1B9832F9ECED344917822D6BDD913E182595`
  - `ticket.py` `F79781F63F0BA0BC92CA3D130E4CF0E3FA187098F67E783A98ED80D9DE42ADA4`
  - `test_assign.py` `5D6EC15C9791DDB85C970BA2BA0655C9FBD6B50967614F098069A308C206D4D4`
  - `test_sla.py` `35B7B60B8689AC4B405E6736E318B0486E582B42A7C1348BC63680DF7B5D6B05`
  - `test_ticket_queue.py` `FBFCFAEF68127BDB0B8677147369614C9517E2E2A2E654FEC54298371F075E02`
- 未启动、未停止 8099；验收时本机 8099 无监听；未调用百炼；未读取或改写运行时业务库
- 测试库：pytest 用 `tmp_path/test.db`；路径不等于 `backend/data/Customer_Service.db`
- 运行时库指纹（验收前后一致）：长度 622592 字节，LastWriteTime `2026-09-17 22:38:41`
- 报告不写口令、Token 或密钥
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec、MessageKind；未执行 Git 写操作
- 会员适配器：`project.json` 为 fallback；空 `member_base_url` 走进程内 Mock（EXT-006）

调度：`execution_mode=automatic`；`sdd_dispatch.py --running-task T-042` 输出 `gate_phase=frontend_in_progress`（T-035）、`tester_ready=["T-035","T-039"]`、T-042 已在 `in_flight_or_queued`。本轮为编排器指定的在途验收收尾，非 integration/delivery。依赖 T-036 / T-038 / T-044 状态为 passed。

Developer `9f32335a-b3f7-491d-98f1-5b1ef2449439` 自称同命令 22 passed。Tester 独立重跑，**不以口头声明代替验证**。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 一线坐席确认资料完整、非高风险退换货；售后专员在岗 | POST API-015 | 处理人售后专员、状态处理中、`queue=normal`、`ticket_no` 非空 | pytest `test_normal_return_exchange_assigns_specialist_in_progress` | `status=in_progress`，`assigned_role=after_sales_specialist`，`assigned_display=售后专员`，`urgency=normal`，`queue=normal`，`ticket_no` 以 `TKT-` 开头 | PASS |
| TC-02 | 会话含「消协」 | 确认工单 | 高风险，处理人高级售后专员 | pytest `test_xiehui_marks_high_risk_for_senior` | `urgency=high_risk`，`queue=high_risk`，`assigned_role=senior_after_sales`，`assigned_display=高级售后专员`，`status=in_progress` | PASS |
| TC-03 | Mock 会员 `complaint_count=3` | 确认工单 | 高风险给高级售后专员 | pytest `test_three_complaints_marks_high_risk` | `urgency=high_risk`，`assigned_role=senior_after_sales`，`queue=high_risk` | PASS |
| TC-04 | VIP 与普通各确认一张退换货 | GET API-020 | VIP `vip_priority`，普通 `normal`，队列不同 | pytest `test_vip_and_normal_use_different_queues` | VIP `urgency=vip`/`queue=vip_priority`；普通 `urgency=normal`/`queue=normal`；列表同时含两队列 | PASS |
| TC-05 | 一线坐席对未分配工单认领 | POST API-021 | 403 FORBIDDEN | pytest `test_frontline_agent_claim_is_forbidden` | HTTP 403，`success=false`，`data=null`，`error_code=FORBIDDEN` | PASS |
| TC-06 | 高风险工单一线 PATCH `urgency=normal`；主管 `approved=false` 再 `true` | PATCH API-022；POST API-023 | 未审批保持高风险 409；拒绝后仍高风险；同意后变普通 | pytest `test_down_high_risk_without_approval_stays_high_risk` | 下调 409 CONFLICT，工单仍 `high_risk`；拒绝后仍高风险；同意后 `urgency=normal`、`queue=normal` | PASS |
| TC-07 | 普通修改地址；冻结时间到 1.5h / 2h / 预警后未满 24h | GET 列表触发 SLA 循环 | 1.5h 预警、2h 升级主管、未满窗口不关 | pytest `test_address_change_warn_escalate_and_not_close_before_window` + `test_compute_windows_use_prd_offsets` | confirm 时 `warn_at=confirmed+1.5h`，`due_at=+2h`，`close_after=warn+24h`；冻结后有 `warned` 进度、升级 `assigned_role=supervisor`/`assigned_display=主管`、三次均 `status!=closed` | PASS |
| TC-08 | VIP 退换货到期 | SLA 循环 | 只升级不关闭 | pytest `test_vip_due_only_escalates_never_closes` | `close_after=None`；到期后 `status!=closed`，`assigned_role=after_sales_supervisor`，`assigned_display=售后主管` | PASS |
| TC-09 | 升级对象无人在岗 | SLA 到期升级 | 处理人展示不空，`upgrade_undelivered=true` | pytest `test_upgrade_without_on_duty_keeps_display` | `assigned_display=主管`，非空且不是「无人认领」；`upgrade_undelivered=true`；`assigned_user_id=null`；未关闭 | PASS |
| TC-10 | 金额线未配置，金额 `999999` | 确认退换货 | 不因金额升 VIP/高风险 | pytest `test_unconfigured_amount_line_does_not_raise_risk` | `urgency=normal`，不是 `high_risk` 也不是 `vip` | PASS |
| TC-11 | 代码 `SLA_RULES` / `effective_sla_rules()` | 对照 PRD / tech-spec 时效档 | 数字一致；地址异常 ≠ 改地址 2h；VIP 不关 | pytest `test_sla_rules_match_prd_numbers` + `test_compute_windows_use_prd_offsets` | 普通改地址 2/0.5/24；退换货 24/4/48；费用 24；投诉 48/8/72；物流延迟 24/4/24、丢件 48/12、地址异常 12≠2；VIP 改地址 0.5h/10min、退换货 4/1、费用 2/0.5、投诉 4、物流延迟 12/3、丢件 24/8、地址异常 6/1.5、`l2_wait_hours=2`、`close_after_warn_hours=None`；计算窗口：改地址 1.5h 预警 / 2h 到期 / 25.5h 可关；VIP 退换货 3h/4h 且 `close_after=None`；普通延迟 20h/24h、丢件 36h/48h、地址异常 12h；VIP 延迟 9h/12h | PASS |
| TC-12 | `member_base_url=""` | 确认工单 | 空地址用 Mock；无会员数据不标 VIP | pytest `test_empty_member_base_url_uses_mock_and_does_not_mark_vip`；读 `get_member_adapter` | Mock `calls` 非空；`urgency=normal`/`queue=normal`；`get_member_adapter` 在无 override 且 URL 空时返回 `MockMemberAdapter` | PASS |
| TC-13 | 一线 PATCH 普通→高风险 | PATCH API-022 | 立即高风险并改派高级售后专员 | pytest `test_raise_to_high_risk_reassigns_senior` | `urgency=high_risk`，`queue=high_risk`，`assigned_role=senior_after_sales` | PASS |
| TC-14 | 草稿不进列表；按类型/工单号筛选 | GET API-020 | 默认不含 draft；筛选项有效；列表字段齐全 | pytest `test_list_excludes_draft_and_filters` | 确认前 `data=[]`；确认后 1 条含 `ticket_no/ticket_type/status/urgency/queue/order_no/assigned_display/upgrade_undelivered/confirmed_at/sla_due_at`；`ticket_type=invoice` 空；按 `ticket_no` 命中 1 条 | PASS |
| TC-15 | 员工列工单；一线只看自己确认单 | GET API-020 | 员工 403；一线可见自己会话工单 | pytest `test_employee_list_is_forbidden` + `test_frontline_list_own_confirmed_ticket` | 员工 403 FORBIDDEN；一线 200 且 `ticket_no` 一致 | PASS |
| TC-16 | 售后专员认领普通 pending；再认领；认领高风险 | POST API-021 | 成功 in_progress；再认领 409；高风险 409 | pytest `test_specialist_can_claim_pending_not_high_risk` + `test_specialist_cannot_claim_high_risk` | 首次 200 `in_progress`/`after_sales_specialist`；再次 409；高风险 409 | PASS |
| TC-17 | 挂起→完成→关闭→再改 | PATCH API-022 | 三态成功；已关闭回写 409 | pytest `test_status_hold_complete_close` | `on_hold`/`completed`/`closed` 均为 200；再 PATCH 409 | PASS |
| TC-18 | 当前非高风险走 API-023 | POST 同意降级 | 409 | pytest `test_supervisor_approval_not_high_risk_is_409` | HTTP 409 | PASS |
| TC-19 | 确认响应序列化 | JSON dump | 不含密钥片段 | pytest `test_member_lookup_payload_is_not_serialized_as_secret` | 无 `sk-`、无 `Bearer ` | PASS |

## 实际执行

```
.\.venv\Scripts\python.exe -m pytest backend/tests/test_assign.py backend/tests/test_sla.py backend/tests/test_ticket_queue.py --timeout=120 -v
```

- 退出码 0
- `collected 22 items`
- `====================== 22 passed, 222 warnings in 37.55s ======================`
- 仅跑上述三个文件；未跑 `test_tickets.py`、`test_agent_knowledge.py`、`test_polish.py`
- 警告来自 Starlette/Pydantic deprecation 与 pycore `datetime.utcnow`，不计入本任务 FAIL

技术检查 1～3 均由上表覆盖，独立重跑与 Developer 自报命令一致且 22 passed。

## AC

本任务 `acceptanceCriteria=[]`。业务结果由 T-050 / T-051 真实验收。

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-067～069、076～081 | 不在本任务判定 | 真实页面分配、列表筛选、挂起关闭与时效归 T-050 |
| AC-088、AC-089 | 不在本任务判定 | VIP 物流一级/二级与立即二级归 T-051 |
| 本阶段 technicalChecks | PASS | 上表 TC-01～TC-19 |

## 未验项

- 真实 8099 直播 HTTP（本轮为 technicalChecks，按派发不启、不杀 8099）
- 关闭 Mock 后的管理端列表、真实会员中心、真实时钟满小时（T-050 / T-051）
- `test_tickets.py` 旧断言（派发明确不跑，不据其判本任务）

## 范围外

- `test_tickets.py` 在确认后仍期望 urgency 为空：已知与本任务打标冲突，不计入 T-042 FAIL；由编排器决定是否另开修复
- pycore / Starlette / Pydantic deprecation 警告，不计入 FAIL
- T-035 前端门禁仍 pending；本任务非 integration/delivery，不阻塞本轮后端 technicalChecks 收尾
