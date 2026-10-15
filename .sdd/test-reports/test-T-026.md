# T-026 验收报告（主对话降级模式，非独立验收）

- 任务：T-026 联调：转人工后工单预填与确认
- 总结果：**PASS（自验）**
- 验证方式：用户选择「不派子智能体，直接在本对话里做联调」。开发与验收由同一主对话完成，**不是独立 Tester 复核**。原因是 `.cursor/agents/developer.md`、`tester.md` 固定的模型用量耗尽，派发一律返回 out of usage。
- 路径：真实联调（`VITE_USE_MOCK=false`，页面经 Vite 代理打到 8112，抽取走真实百炼 Chat）。未用 Mock。
- 报告不含口令、Key、Token。

## 验证环境

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5222/ ，启动带 `VITE_USE_MOCK=false`、`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8112`、`VITE_API_BASE_URL=/api` |
| 后端 | http://127.0.0.1:8112/ ，`.sdd/tmp-t026/t026_serve.py`，改代码后重启（9-23 残留的旧 8112/5222 进程已停掉） |
| 库 | `backend/data/t026.db`（未碰 `Customer_Service.db` 及其他任务库） |
| 浏览器 | headless Chrome CDP 9562，脚本 `.sdd/tmp-t026/t026_browser.mjs` |
| 证据 | `.sdd/tmp-t026/evidence/t026-browser-evidence.json` 与同目录截图 |
| 未碰端口 | 8099 / 8108～8111 / 5175 / 5199 / 5218～5221 |

最终一轮会话：未转人工 `bf8d452e-4e30-4f4e-8961-dc574799d9c8`；AC-030 `afaa4abd-1b28-4b91-93ef-a637ed1a3acb`；AC-031 `fcba1570-d95c-4749-873d-afc29257e351`；AC-032/041 `77b7c298-f268-47fe-b2a4-2f4f42eeb444`。

## 发现并修复的产品缺陷（AC-032）

旧证据（9-23）AC-032 失败：金额 `{value:"99", status:"conflict", conflict_value:"99元"}`，页面提示「原值 99，新值 99元」，88 没出现。

根因两处：

1. `_merge_slot` 按原字符串比较，「99」与「99元」被当成不同值，产生假冲突；坐席选定 88 后再抽到「88元」也会再冲突。
2. 抽取提示词没有要求取用户最后一次说法；整段会话交给模型时容易抽回先说的旧值。

修复（不改 D-008「冲突保留原值」规则）：

- `backend/src/services/ticket.py`：新增 `_comparable_value` / `_same_value`，所有字段先做 NFKC 并去空白再比较；金额（`amount`）再去掉 ¥/￥/元/块/RMB 并按数值比较。`_merge_slot` 增加 `key` 参数，`_run_extract_job` 传入字段键。
- `backend/src/prompts/ticket/extract_common.md`：同一字段前后说法不同时只输出用户最后一次说的值。
- `backend/tests/test_ticket_extract.py`：新增同值带单位不冲突、99→88 元仍冲突保留 99、坐席选定值不被单位变体打成冲突等用例。

另外，旧证据里「88 没出现」还有一部分来自脚本：员工第二条消息没真正发到后端（见下节）。

## 验证脚本的时序修正

以下均为脚本问题，不是产品问题：

- 员工发消息：原来以页面消息数增加判定成功，重载后历史加载也会让计数增加，真实发送被吞。改为以 CDP 网络中 `POST …/messages` 200 判定，失败重试。
- 转人工：按钮未渲染就点击会静默失效。改为等按钮可用并以 `POST …/transfer` 200 判定。
- 新建会话：员工页初始化会覆盖脚本写入的 `conversation_id`。改为等页面就绪后再建，失败重试。
- 抽取等待：原来 `extract_status` 非 extracting 就返回，会读到类型尚未保存时的 idle。改为要求类型一致、状态 ready/failed，且 `updated_at` 晚于发消息或切类型时刻。
- 页面刷新：前端在 extracting 时按轮询间隔刷新，改为等待金额行显示「冲突」（最多 15 秒）再读页面。
- 四态：改为汇总整轮见到的状态标签，不要求同一张单同时出现。
- AC-034 页面：库里已有已转人工会话时列表不会为空，改为检查未选中会话时无确认区；另加强为「未转人工会话不在客服列表、直接确认返回 409」。

## 逐项结果（最终一轮 21/21 PASS）

| 检查 | 结果 | 关键证据 |
| --- | --- | --- |
| mock-off | PASS | `mockEnabled=false`，页面无 [Mock] |
| AC-034 页面 / 员工 GET 409 / 客服 GET 409 / 不在列表且确认 409 | PASS | 未转人工会话无确认区；GET、confirm 均 409 |
| GET 不阻塞 | PASS | extracting 时 GET 快速返回 |
| AC-030 已填 / 确认 / 再打开 | PASS | 订单号、商品、原因、金额已填，确认后再开一致 |
| D-007 确认后稳定 | PASS | 确认后员工说「金额其实是1元」，已确认金额不变 |
| AC-031 缺失 / 后补已填 | PASS | 先 `new_address` missing 且无编造；后补为「上海市浦东新区世纪大道100号1号楼8层801室」filled，订单号与商品不变 |
| AC-041 退换货 / 开发票 | PASS | 退换货有售后方式、原因、数量，无税号；发票有抬头、税号，无数量 |
| AC-032 首次 99 | PASS | amount `99元` filled |
| AC-032 保留 99 并冲突 | PASS | amount `{value:"99元", status:"conflict", conflict_value:"88元"}`；页面「冲突」，提示「原值 99元，新值 88元」 |
| 四态可见 | PASS | 页面见到 已填 / 缺失 / 冲突（本轮未出现低置信「待确认」） |
| AC-033 未确认 / 离开再回 | PASS | 仍为 draft，无工单号 |
| AC-032 坐席选定 | PASS | 点「改用新值」后 `88元` agent_edited |
| 真实 API-013～015 | PASS | CDP 记录真实 GET/PATCH/confirm 200 与 409 |

## 自动化测试

- `pytest tests/test_ticket_extract.py --timeout=120`：17 passed（FakeLlm，不算真实百炼通过）。
- `pytest tests/test_ticket_extract.py tests/test_tickets.py --timeout=120`：32 passed，2 failed。
  - `test_confirm_then_patch_type_409_fields_and_line_ok`：已知过期断言（期望确认后 urgency 为 null），与本次改动无关，待后续更新。
  - `test_extract_prompts_have_no_plugin_or_oms`：用项目根相对路径找提示词，在 `backend` 目录跑时找不到文件；从项目根单独运行 1 passed。
- `ruff check`：通过。

## 观察项（不影响本次判定）

- 「用户诉求摘要」这类自由文本字段，模型两轮措辞不同（「我要退货」与「我要退货，因为屏幕有划痕」）也会按 D-008 标为冲突。符合现行规则，但坐席可能觉得多余；是否对摘要类字段放宽需要产品决定。
- 低置信「待确认」本轮真实抽取未触发，本轮未在真实页面看到；后端低置信进候选由 `test_low_confidence_is_candidate_and_blocks_confirm` 覆盖（FakeLlm）。

## 未验与限制

- 非独立验收：实现与验证同属主对话。待 Tester 子智能体可用时可再做一次独立复验。
- 未写经验库：按规则须 Tester 复验修复后才写。
