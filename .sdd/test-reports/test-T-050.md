# T-050 验收报告（主对话降级模式，非独立验收）

- 任务：T-050 联调：自动分配、紧急程度、列表筛选与普通/VIP 时效
- 总结果：**PASS（自验）**
- 验证方式：沿用用户选的「c」与「2.A」，开发与验收由同一主对话完成，**不是独立 Tester 复核**。
- 路径：真实联调。`VITE_USE_MOCK=false`，工单列表在真实页面上操作；确认、分配、筛选、挂起/完成/关闭、紧急程度上调与审批走真实 API。会员 EXT-006、物流用隔离 Mock；SLA 用改库 SLA 时间戳的测试时钟，**未改 PRD 时效数字**。
- 报告不含口令、Key、Token。

## 验证环境

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5228/ ，`VITE_USE_MOCK=false`、`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8117` |
| 后端 | http://127.0.0.1:8117/ ，`.sdd/tmp-t050/t050_serve.py`（内存覆盖库/上传/端口/CORS；FileMemberAdapter + MockLogisticsAdapter） |
| 库 | `backend/data/t050.db`（新建；未碰 `Customer_Service.db`） |
| 浏览器 | headless Chrome CDP 9567，脚本 `.sdd/tmp-t050/t050_browser.mjs` |
| API 探针 | `.sdd/tmp-t050/t050_probe.py`（含 `scan()`：先 list 触发 SLA 再读会话工单） |
| 证据 | `evidence/t050-probe.json`、`evidence/t050-browser-evidence-r6.json`、同目录截图 |
| 未杀端口 | 8099 / 5175 / 5199 及其他任务占用端口 |

## 逐项结果

### API + 测试时钟（最终 PROBE_PASS=True）

| 检查 | 结果 | 实际 |
| --- | --- | --- |
| AC-067 确认后分配售后专员 | PASS | 退换货确认后 `assigned_role=after_sales_specialist`、列表可见工单号/类型/订单号、状态处理中 |
| AC-068 六类筛选 | PASS | 类型/状态/订单号/工单号/用户/时间各筛一次，只见符合条件项 |
| AC-069 挂起→完成→关闭 | PASS | `hold_reason=wait_warehouse` 暴露；completed → closed，列表同步 |
| AC-076 消协 + 连续三诉 | PASS | 均为 `high_risk`，处理人高级售后专员 |
| AC-077 上调/未批下调/主管同意 | PASS | 上调立即高风险改派；下调 409；主管同意后 normal |
| AC-078 改址 1.5h/2h/关闭预告 | PASS | warn 90min、due 120min、close_gap 24h；到点升级主管；发出 `close_notice`；未满窗不关 |
| AC-079 投诉关闭规则 | PASS | 预告后用户再说 → `close_skipped` 不关；沉默到点关闭；warn 后再 72h |
| AC-080 VIP 队列与各类型窗口 | PASS | VIP/普通不同队列；VIP 退换 3h/4h、投诉 3h/4h、费用 1.5h/2h、改址 20/30min；无人在岗 `upgrade_undelivered` 且显示售后主管 |
| AC-081 物流窗口 | PASS | 延误 20/24 + 预警后 24h；丢件 36/48；地址异常 due 12h≠2h；到点不提前关 |

### 真实前端 UI（最终 r6：BROWSER_PASS=true）

| 检查 | 结果 | 实际 |
| --- | --- | --- |
| 前端未用 Mock | PASS | `isMockEnabled()=false` |
| AC-067 列表行 | PASS | 工单号/退换货/处理中/售后专员 |
| AC-067 详情订单号 | PASS | 详情 hint 含「订单 …」 |
| AC-068 类型筛选 | PASS | 筛 `address_change` 后不见该退换货单 |
| AC-069 挂起/完成/关闭 | PASS | 挂起等用户补充 → 已完成 → 已关闭 |
| AC-076 高风险展示 | PASS | 列表高风险 + 高级售后专员 |
| AC-077 上调与审批 | PASS | 「上调为高风险」后立即改派；下调接口 409；主管同意变普通 |

## 轮次说明

| 轮次 | 结果 | 说明 |
| --- | --- | --- |
| probe 初轮 | 部分 FAIL | 会话 GET 不触发 SLA；`hold_reason` 未进 TicketPublic；字段枚举不符 |
| probe 修复后 | PASS | `scan()`、关闭预告、hold_reason、费用附件与枚举 |
| browser r1–r2 | FAIL | 脏库连续三诉抬高风险 / 列表加载未等完 |
| browser r3–r5 | 部分 PASS | 详情缺 order_no；按钮文案；等待 acting |
| browser r6 | 全 PASS | 干净库 + 详情 order_no + 等待逻辑 |

## 产品改动摘要

1. **SLA 关闭预告**：非 VIP 到 `due_at` 写入含「关闭预告」的进度（`close_notice`），再按 `close_after` 与用户是否续聊决定是否自动关。
2. **`hold_reason`**：`TicketPublic` / 列表详情可返回 `wait_user` / `wait_warehouse`；挂起进度文案含「等用户补充」「等仓储确认」。
3. **详情订单号**：`TicketPublic` 增加 `order_no`（及可选 `user_name`），`to_ticket_public` 从字段回填，工单列表详情可显示「订单 …」。

## 自动化检查

- `t050_probe.py`：PROBE_PASS=True
- `t050_browser.mjs` r6：BROWSER_PASS=true
- `pytest backend/tests/test_sla.py backend/tests/test_assign.py`：15 passed

## 未验 / 说明

- 本报告为降级自验，**不是独立验收**；经验库不落盘。
- AC-078～081 用改库 SLA 时间戳模拟时钟，数字与 PRD 一致，未缩短产品配置。
- 未 Git；未写口令或 Key。
- 下一联调：T-051。
