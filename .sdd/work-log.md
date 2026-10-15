# 工作日志

由编排器记录关键进展、验证证据、用户确认和阻塞原因。任务运行状态以 `.sdd/tasks.json` 为准，日志不维护第二份任务清单。

## 2026-10-10 T-028 页面功能导航刷新 PASS（非独立验收）

- 用户要求「整轮收口」，在主对话完成交付 T-028。
- 刷新 `docs/project-map.json` / `project-console.html` / `README.md`：补工单列表、模板管理、API-013～035、EXT-003～007、分配/SLA/润色/模板算法与文件指纹。
- 静态服务 8767 + CDP 9570 浏览器 DEL-001～005 全 PASS。报告 `.sdd/test-reports/test-T-028.md`。T-028 → passed。
- 未改业务代码。未写经验库。不 Git。本轮联调+交付链已收口。

## 2026-10-10 T-051 主对话降级联调 PASS（非独立验收）

- 按自动联调在主对话完成 T-051，结果标为自验。
- 环境：8118、`t051.db`，探针 `.sdd/tmp-t051/`。VIP 物流窗口、一级/二级、补偿立即二级、等待 2h、四类立即二级、无人在岗均 API+时钟 PASS。
- 产品改动：临近时限立即二级仅在「未到期且剩余 ≤2h」成立，过期无赔付单不再误升二级。
- 报告 `.sdd/test-reports/test-T-051.md`。T-051 → passed。未写经验库。不 Git。下一联调：T-052。

## 2026-10-10 T-050 主对话降级联调 PASS（非独立验收）

- 按用户「继续」在主对话完成 T-050，结果标为自验。
- 环境：隔离 8117/5228、`t050.db`、CDP 9567，脚本在 `.sdd/tmp-t050/`。前端关 Mock；会员/物流用隔离 Mock；SLA 用改库时间戳测试时钟，未改 PRD 数字。
- 产品改动：非 VIP 到点发「关闭预告」；`hold_reason` 对外暴露；挂起进度文案；`TicketPublic.order_no` 供列表详情展示订单号。
- API 探针 AC-067～081 全 PASS；浏览器 r6 全 PASS（067/068/069/076/077 UI）。`test_sla`+`test_assign` 15 passed。报告 `.sdd/test-reports/test-T-050.md`。T-050 → passed。
- 未写经验库。不 Git。下一联调：T-051。

## 2026-10-10 T-049 主对话降级联调 PASS（非独立验收）

- 按用户「继续」在主对话完成 T-049，结果标为自验。用户选 A：补真实评测指标（采纳/修改/抽取准确率按版本分开，无样本「暂无数据」）。
- 环境：隔离 8116/5227（5226 占用）、`t049.db`、CDP 9566，脚本在 `.sdd/tmp-t049/`。模板保存/预览/灰度/回滚/告警在真实管理端；润色与拦截走真实百炼，前端未用 Mock。
- 产品改动：润色事件落会话与去向；发送后记 adopted/modified；确认工单抽字段计入准确率；`GET /api/evaluation-sets/current`；写路径显式 commit；版本时间 UTC；前端刷新可读条数、分版本指标、真实模式无 Mock 提示。
- 浏览器最终 r4 全 PASS（r1 也曾全过；r2/r3 为脏库/时区中间轮）。报告 `.sdd/test-reports/test-T-049.md`。T-049 → passed。tech-spec 补 API-032a。
- 未写经验库。不 Git。下一联调：T-050。

## 2026-09-28 T-047 主对话降级联调 PASS（非独立验收）

- 按用户「2.A」「好的」在主对话继续联调，结果标为自验。
- 环境：隔离 8115/5225、`t047.db`、CDP 9565，脚本在 `.sdd/tmp-t047/`。知识三篇：过期旧版退货（15 天）、现行版退货（7 天）、服饰售前尺码。知识推送与润色走真实百炼，前端未用 Mock。
- 修了四个产品问题：
  - 管理端评测指标的坐席反馈写死「暂无回流问题」，改为按模板汇总真实反馈（`templates.py`）。
  - 润色会丢掉原稿金额：`polish.md` 要求保留每个时效/金额/政策名，`check_compliance` 新增「删掉原稿金额」拦截。
  - 售前润色被加上退换货说法（2/5）：服饰业务线提示词与抽取共用、写着退换货口径，改为润色在未选类型时标「售前咨询（未建工单）」并加售前边界，修复后 0/5。
  - 愤怒会话里轻快原稿被保留「亲，」：原本合规拦截不能采用，补提示词后 0/5。
- 浏览器第 2、3、4 轮均 22/22 PASS（第 1 轮是脚本按列表位置点错会话，已修脚本）。真实润色探针各场景 5 次全部达标。后端全量 199 passed，2 条已知过期断言失败；全量 ruff 有 7 处在 ticket_queue/member/assign/sla，非本任务文件。报告 `.sdd/test-reports/test-T-047.md`。T-047 → passed。
- `polish.md`、`polish.py` 与 T-027 共用，T-027 浏览器脚本未重跑。
- 未写经验库。8115/5225 仍在运行。不 Git。

## 2026-09-28 T-046 主对话降级联调 PASS（非独立验收）

- 按用户「2.A」在主对话继续联调，结果标为自验。
- 环境：
  - 隔离环境 8114/5224、`t046.db`、CDP 9564，脚本在 `.sdd/tmp-t046/`。
  - 订单中心、物流没有真实凭证：后端用真实 HTTP 适配器打到替身 8134，由 `ext_state.json` 切换一条/两条/零条/失败、已签收/查不到。
  - 抽取与润色走真实百炼，前端未用 Mock。
- 修了三个产品缺陷：
  - 证据截图上传被 axios 按 JSON 发送，一律 400，费用争议无法确认。修复 `ticketService.ts`，与文档上传一致。
  - 退换货抽取把「昨天」输出为 null，订单中心收不到时间。修复 `extract_common.md`，真实探针 5/5。
  - 真实环境不返回物流说明 `note`。后端补字段与文案，物流摘要改为「用户称……」，并补单测。
- 浏览器两轮均 24/24 PASS。后端全量 197 passed，2 条已知过期断言失败。ruff、tsc、eslint 通过。报告 `.sdd/test-reports/test-T-046.md`。T-046 → passed。
- 留给 T-047（AC-050）：润色会丢掉原稿里的主张金额 200 元。
- `extract_common.md`、`ticket.py` 与 T-026 共用，T-026 浏览器脚本未重跑。
- 未写经验库。8114/5224/8134 仍在运行。不 Git。

## 2026-09-28 T-027 润色质量修复 PASS（用户「1.A」，非独立验收）

- T-027 重开为 in_progress，write_scope 补入 `polish.md`、`line_digital_3c.md`、`polish.py`、`test_polish.py`。
- 根因有两处：
  - 3C 业务线提示词要求「使用只换不修等口径」，压过了润色规则。
  - 用户提示词里坐席已发回复与拟发稿没有区分。
- 修复：
  - 润色规则：以原稿为准；不复述已发回复；不补政策、承诺、进度；原稿过短时只补一句下一步建议；不提内部信息。
  - 3C 口径改为已涉及保修、质量时才用。
  - 会话里坐席消息标「已发出」，提示词末尾加边界句。
  - 新增单测。
- 真实百炼探针每场景 5 次：
  - 追发复述从 3/5 降到 0/5。
  - 3C 投诉补新政策从 3/5 降到 0/5，5 次全部可采用。
  - AC-038 保留超时与其他办法。
- 浏览器全量重跑 22/22 PASS。后端全量 196 passed，2 条无关旧断言失败（`test_tickets` urgency、`test_qa` 断言 qa.py 不含「工单」），待后续更新。ruff 通过。
- T-027 → passed，报告已补「润色质量修复」节。未写经验库。不 Git。

## 2026-09-28 T-027 主对话降级联调 PASS（非独立验收）

- 沿用用户选的「c」模式，主对话兼任开发与验收，结果标为自验。未改业务代码。
- 隔离环境 8113/5223、`t027.db`，脚本在 `.sdd/tmp-t027/`。知识只放服饰七天无理由与 3C 质保两份，不放投诉升级政策。
- 真实百炼浏览器两轮均 22/22 PASS。中途收紧两处脚本：推送等页面渲染再读；合规未通过时按接口原始润色稿判定。报告 `.sdd/test-reports/test-T-027.md`。T-027 → passed。
- 观察项待产品决定：润色会把上一条坐席回复整段并入；3C 投诉润色常加「只换不修」被合规拦下，几乎无法采用。
- 未写经验库。8113/5223 仍在运行。剩余 T-046、T-047、T-049、T-050、T-051，之后交付 T-028。不 Git。

## 2026-09-28 T-026 主对话降级联调 PASS（非独立验收）

- 用户选「c」：不派子智能体，主对话兼任开发与验收。结果如实标为自验，不称独立复核。
- T-026 write_scope 补入 `backend/src/services/ticket.py`、`backend/src/prompts/ticket/extract_common.md`、`backend/tests/test_ticket_extract.py`。
- 产品缺陷 AC-032：「99」与「99元」按原字符串比较产生假冲突，88 丢失。修复：合并前按字段规范化比较（金额去单位按数值比），提示词要求取用户最后一次说法。D-008「冲突保留原值」不变。
- 验证脚本修正：员工发消息、转人工以真实 POST 200 判定；抽取等待要求类型一致且晚于发消息；四态汇总整轮；AC-034 加强为不在列表且确认 409。
- 停掉 9-23 残留的 T-026 旧进程（8112/5222）后用新代码重启。其他任务端口未碰。
- 真实百炼浏览器 21/21 PASS；pytest 抽取 17 passed；`test_tickets.py` 仅已知过期的 urgency 断言失败。报告 `.sdd/test-reports/test-T-026.md`。T-026 → passed。
- 未写经验库（需 Tester 复验）。8112/5222 仍在运行，便于查看。不 Git。

## 2026-09-28 查明用量中断原因

- 通用子智能体（跟随当前模型）探测可用。`developer` 子智能体即使指定跟随当前模型仍报用量用尽。
- 原因：`.cursor/agents/developer.md` 固定 `grok-4.6[effort=high]`，`tester.md` 固定 `grok-4.6[effort=medium]`，该模型额度用尽，且配置里的模型会覆盖派发时的指定。
- 换通用子智能体、改配置或在主对话做联调，都要用户决定。用户未选，暂不派发。T-026/T-027 仍 pending。不 Git。

## 2026-09-28 用量探测失败

- T-026 Developer 362365c7-a181-421b-8179-88455a0e505a 启动后立刻报用量用尽。不算代码 FAIL。T-026 → pending。
- 更正：项目侧就绪，但 Task 子智能体额度仍不可用。不自动重派。不 Git。

## 2026-09-28 用量探测并恢复 T-026

- 项目侧一直就绪（门禁已过，T-026 等 7 项联调可派）。
- 已派 T-026 Developer 362365c7-a181-421b-8179-88455a0e505a（8112/5222）探测额度；若能跑完再开 T-027。不 Git。

## 2026-09-24 继续开发因用量再次中断

- T-026 Developer 10c16152-5ac4-4a63-a245-8c03b22bb1b3、T-027 Developer b249639a-ea27-4da1-8563-da21d7e29dd8 均因用量用尽未启动。不算代码 FAIL。两任务 → pending。
- 额度未真正恢复前不再自动重派。不 Git。

## 2026-09-24 用户要求继续

- 恢复 T-026：Developer 10c16152-5ac4-4a63-a245-8c03b22bb1b3，端口 8112/5222。
- 并行 T-027：Developer b249639a-ea27-4da1-8563-da21d7e29dd8，端口 8113/5223。不 Git。

## 2026-09-23 继续开发第四次因用量中断

- T-026 Developer 35eb27e2-fef3-4662-80ef-be1aa73abfa5、T-027 Developer 97977e5a-fda4-480a-b1f6-7533b9cc76c2 均因用量用尽未启动。不算代码 FAIL。两任务 → pending。
- 额度未真正恢复前不再自动重派。不 Git。

## 2026-09-23 用户第四次要求继续

- 恢复 T-026：Developer 35eb27e2-fef3-4662-80ef-be1aa73abfa5，端口 8112/5222。
- 并行 T-027：Developer 97977e5a-fda4-480a-b1f6-7533b9cc76c2，端口 8113/5223。不 Git。

## 2026-09-23 继续开发第三次因用量中断

- T-026 Developer bd60065a-0023-423e-869e-2e074967b8c1、T-027 Developer b77b8a44-4058-4e09-b225-15e30c6cae17 均因用量用尽未完成。不算代码 FAIL。两任务 → pending。
- 额度未恢复前不再自动重派。不 Git。

## 2026-09-23 用户再次要求继续

- 恢复 T-026：Developer bd60065a-0023-423e-869e-2e074967b8c1，端口 8112/5222。
- 并行 T-027：Developer b77b8a44-4058-4e09-b225-15e30c6cae17，端口 8113/5223。不 Git。

## 2026-09-23 继续开发因用量再次中断

- T-026 Developer fa7e7c04-9bbf-4ade-a46b-01ca1d66011a、T-027 Developer 953f4cba-a0bb-4a8c-883c-cbc45a967467 均因用量用尽未启动成功。不算代码 FAIL。两任务 → pending。
- 额度恢复或切到 Auto 后再派。不自动重开。不 Git。

## 2026-09-23 用户要求继续开发

- 恢复 T-026：Developer fa7e7c04-9bbf-4ade-a46b-01ca1d66011a，复用 `.sdd/tmp-t026/`，端口 8112/5222。
- 并行开 T-027：Developer 953f4cba-a0bb-4a8c-883c-cbc45a967467，端口 8113/5223。不 Git。

## 2026-09-23 T-026 因用量中断

- Developer 7aff783a-e2bc-4460-badf-c7422c477c12 未完成：账号用量已用尽。不算代码 FAIL，retry_count 不变。T-026 → pending。
- 半成品在 `.sdd/tmp-t026/`（serve、浏览器脚本、evidence）。计划端口仍是 8112/5222。额度恢复后再派，不自动重开。不 Git。

## 2026-09-23 T-045 复验 PASS

- Tester 33229157-3da6-4927-80a9-df0c052463dc：AC-060 PASS，AC-053、AC-059 抽查无回退。报告 `.sdd/test-reports/test-T-045.md`。原 FAIL 保留。T-045 → passed。
- 不新增经验：坐席能搜到高风险全文已验证，但搜索词常驻和文件名计分未做对照，根因拆分仍是推测。
- T-026 曾在联调，现因用量暂停。

## 2026-09-23 T-045 修复后交复验

- Developer b9799d9b-b415-4613-9b27-ff8b57dd91f6 自验：坐席按文件名或正文能打开高风险全文，搜索不再被无搜索词的刷新盖掉，员工侧仍无该口径。test_agent_knowledge.py 与 test_retrieve.py 19 passed。8110 已重启。T-045 → testing。
- 已派 Tester 33229157-3da6-4927-80a9-df0c052463dc 复验 AC-060，并抽查 AC-053/059。经验候选先不落盘。不 Git。
- 召回改动已收口，已派 T-026 Developer 7aff783a-e2bc-4460-badf-c7422c477c12，端口 8112/5222。不改 8110。

## 2026-09-23 T-025 Tester PASS

- Tester 2a4a83f6-eee6-4f21-92c9-5bd09bd9b2ff：AC-001、012、013、014、015、016、019、021 PASS。报告 `.sdd/test-reports/test-T-025.md`。T-025 → passed。
- 验的是未重启的 8111（pid 25420，内存 retrieve `05dd24ee188dad98`）。磁盘 retrieve 已是 T-045 修改中的 `e575872d05b29cfa`，本轮不另开联调，等这次召回改动收口后再派下一档。不 Git。

## 2026-09-23 T-025 交验收

- Developer a7e1d656-8352-4c2d-80b0-ce4076563f8c 用真实接口自验 AC-001、012、013、014、015、016、019、021。前端 http://127.0.0.1:5221/ ，后端 8111，库 data/t025.db。未改业务代码。T-025 → testing。
- 已派 Tester 2a4a83f6-eee6-4f21-92c9-5bd09bd9b2ff。验收沿用现有 8111 进程，不重启，以免吃到 T-045 正在改的召回代码。不 Git。

## 2026-09-23 T-045 FAIL，修复坐席高风险搜索

- Tester a197a1e9-3e14-4bfb-8c48-8ea988b00f94：AC-053、AC-059 PASS；AC-060 FAIL。坐席右栏搜索高风险文档后仍停在默认两张卡片；按文件名搜索接口为空。报告 `.sdd/test-reports/test-T-045.md`。
- T-045 → fixing，retry 1。已派 b9799d9b-b415-4613-9b27-ff8b57dd91f6。写入范围补上知识面板、工单刷新、坐席召回与对应测试。不 Git。员工自动回答不使用高风险文档这一点保持不变。

## 2026-09-23 T-052 复验 PASS

- Tester e3789cbd-2333-4d55-8f97-2228d495116d：AC-070、AC-071、AC-075 PASS。报告 `.sdd/test-reports/test-T-052.md`。T-052 → passed。此前 FAIL（工作台不显示进度、列表无 id、GET 405）保留在 notes。
- 已沉淀经验「隔离 uvicorn 不热加载：新路由要重启进程才验得到」。未写入全局经验。
- 下一档联调只开 T-025，Developer a7e1d656-8352-4c2d-80b0-ce4076563f8c，端口 8111/5221。T-045 验收仍占用 8110/5220。不 Git。

## 2026-09-23 T-045 交验收

- Developer db0e362e-8d84-47b7-a661-17c628de173a 用真实接口自验 AC-053、AC-059、AC-060。前端 http://127.0.0.1:5220/ ，后端 8110，库 data/t045.db。未改业务代码。T-045 → testing。
- 已派 Tester a197a1e9-3e14-4bfb-8c48-8ea988b00f94 独立点页面。不另开新联调。不 Git。

## 2026-09-23 T-052 修复后交复验

- Developer 01109886-c0da-474b-90a3-03df679b4d0f 补上列表 id、GET /api/tickets/{id}，以及工作台和列表上的进度原文。test_ticket_queue.py 10 passed。8109 尚未重启。T-052 → testing。
- 已派 Tester 复验 AC-070/071。经验候选等复验后再决定。不 Git。

## 2026-09-23 T-052 FAIL，修复进度展示

- Tester 26601711-23e3-4342-ae7b-0798192f01aa：AC-075 PASS；AC-070/071 FAIL。坐席打开工单看不到进度，列表点行无详情，GET /api/tickets/{id} 为 405。报告 `.sdd/test-reports/test-T-052.md`。
- T-052 → fixing，retry 1。已派 01109886-c0da-474b-90a3-03df679b4d0f 补列表 id、单张工单 GET，以及工作台和列表上的进度原文。不 Git。

## 2026-09-23 T-048 Tester PASS，派知识可见范围联调

- Tester b186d90f-3e5e-4b71-bd70-d13bded8d34d：AC-061 PASS。报告 `.sdd/test-reports/test-T-048.md`。T-048 → passed。
- T-052 仍在页面验收。已派 T-045 db0e362e-8d84-47b7-a661-17c628de173a，端口 8110/5220。不 Git。

## 2026-09-23 T-048 交验收

- Developer 8e9cb8a1-7dfc-4c8d-ba00-88fb97517a82 用真实接口自验 AC-061。前端 http://127.0.0.1:5218/ ，后端 8108，库 data/t048.db。T-048 → testing。
- 已派 Tester 点坐席 403 与管理可打开模板。不 Git。

## 2026-09-23 T-052 交验收

- Developer 9565f24b-3d7e-4c57-867a-899fb6451cff 用真实 API 自验退货/开票与进度问答。前端 http://127.0.0.1:5219/ ，后端 8109，库 data/t052.db。T-052 → testing。
- 工作台可能不展示 progress，GET /api/tickets/{id} 为 405。已派 Tester 点页面核对 AC-071。不 Git。

## 2026-09-23 T-041 Tester PASS，开始两路联调

- Tester fa318b66-f4b5-4bb0-92da-6f258a9a529f：退货开票联动 PASS。报告 `.sdd/test-reports/test-T-041.md`。T-041 → passed。
- 已派 T-048 8e9cb8a1-7dfc-4c8d-ba00-88fb97517a82（8108/5218）、T-052 9565f24b-3d7e-4c57-867a-899fb6451cff（8109/5219）。其余联调仍待派。不 Git。

## 2026-09-23 T-040 Tester PASS

- Tester 846a7ae7-ca3c-4c57-9022-125b396f5172：证据附件与当次反馈 PASS。报告 `.sdd/test-reports/test-T-040.md`。T-040 → passed。业务验收仍在 T-046/T-047。
- 真实联调已就绪，但仍等 T-041 Tester，避免同时抢 8099。不 Git。

## 2026-09-23 用户认可 Mock，恢复后端验收

- 用户回复「可以的」。T-035 user_gate → passed。百炼配置此前已为非占位，不重填。
- 已派 T-040、T-041 的 Tester。真实联调先不并行抢 8099，等这两项 pytest 收尾。不 Git。

## 2026-09-23 T-041 完成，验收暂缓

- Developer d9708ce6-9fd5-4e0f-b4b8-907fbc6b011b 补上 `ticket_progress`。指定 pytest 10 passed。T-041 → testing。
- T-035 user_gate 仍为 awaiting_user，不派 Tester。不 Git。

## 2026-09-23 T-041 进度类型扩范围

- Developer d9708ce6-9fd5-4e0f-b4b8-907fbc6b011b：联动 Mock 7 项通过；询问进度因 MessageKind 无 ticket_progress 失败。
- 已把 `backend/src/models/conversation.py` 加入 T-041 写入范围并续写。用户门禁仍在，续写结束后不派 Tester。不 Git。

## 2026-09-23 T-040 完成，验收暂缓

- Developer 647b15e1-26bb-4c51-a855-ca1d17d3f8e2 完成证据截图与当次反馈。自称 pytest 7 passed。T-040 → testing。
- T-035 user_gate 仍为 awaiting_user，不派 Tester。不 Git。

## 2026-09-23 T-035 Tester PASS，等待用户看 Mock

- Tester c17efeca-b2c7-4cf3-9563-8c2818b9f0e1：本轮前端 Mock 收口 PASS。报告 `.sdd/test-reports/test-T-035.md`。预览 http://127.0.0.1:5199/ 。
- T-035 → passed。user_gate → awaiting_user。百炼三项配置仍为非占位，不要求重填，未记录密钥。
- 停止新的开发、验收、联调派发。T-040、T-041 若仍在写，只收尾，返回后不立刻派 Tester。不 Git。

## 2026-09-23 T-042 Tester PASS，派附件与联动

- Tester 20ac9393-6c1c-4c6f-bc2a-892de741f3fc：分配与时效 PASS。报告 `.sdd/test-reports/test-T-042.md`。T-042 → passed。
- 已派 T-040 647b15e1-26bb-4c51-a855-ca1d17d3f8e2、T-041 d9708ce6-9fd5-4e0f-b4b8-907fbc6b011b。test_tickets.py 旧断言仍待联动落地后再改。不 Git。

## 2026-09-23 T-039 Tester PASS

- Tester 01884626-9045-45f8-9067-8f9c7d4dfaa1：坐席知识与润色 PASS。报告 `.sdd/test-reports/test-T-039.md`。T-039 → passed。真实百炼仍在 T-027/T-047。
- T-040 已就绪，但会改 `tickets.py`，与正在验收的 T-042 冲突，先不派。不 Git。

## 2026-09-23 T-042 交验收

- Developer 9f32335a-b3f7-491d-98f1-5b1ef2449439 完成分配、认领和时效。自称 pytest 22 passed。T-042 → testing。
- test_tickets.py 仍期望确认后 urgency 为空，与新行为冲突，本任务 PASS 后单独改断言。已派 Tester。不 Git。

## 2026-09-23 T-035 交验收

- Developer e996e0c6-a2f1-40d3-acd9-84faeae52e53 把 API-001～035 挂到 mockAdapter。页面 Mock 仍多走 service 直连。T-035 → testing。
- 已派 Tester 走全页。通过前不把 user_gate 交给用户。不 Git。

## 2026-09-23 T-039 交验收

- Developer ea4a0ea1-a38b-4579-aeb8-808c0b1a5b93 完成坐席知识溯源与合规润色。自称 pytest 23 passed。T-039 → testing。
- 已派 Tester。不派 T-040，等本任务 PASS 且不与 T-042 抢 ticket.py。不 Git。

## 2026-09-23 T-033 Tester PASS，派 Mock 收口

- Tester 4d0b0ca2-5c94-4b5a-9952-0d0a48a72f24：工单列表 Mock PASS。报告 `.sdd/test-reports/test-T-033.md`。预览 http://127.0.0.1:5293/ 。T-033 → passed。
- 本轮前端页已齐，已派 T-035 e996e0c6-a2f1-40d3-acd9-84faeae52e53 收口。门禁仍 pending。不 Git。

## 2026-09-23 T-034 Tester PASS

- Tester 99c5cc25-72cd-4e4b-a2f4-f812d840b94d：模板管理 Mock PASS。报告 `.sdd/test-reports/test-T-034.md`。T-034 → passed。预览 http://127.0.0.1:5288/templates 。
- 整页收口 T-035 仍等 T-033。不 Git。

## 2026-09-23 T-038 Tester PASS，派知识润色与分配

- Tester 1c714a02-b4ec-42a8-9ad9-08f63b297e0f：工单抽取 PASS。报告 `.sdd/test-reports/test-T-038.md`。T-038 → passed。
- 已派 T-039 ea4a0ea1-a38b-4579-aeb8-808c0b1a5b93、T-042 9f32335a-b3f7-491d-98f1-5b1ef2449439。不派 T-040/T-041。不 Git。

## 2026-09-23 T-033 交验收

- Developer d0eb8a07-f9dc-4872-90a4-119d4cbe3422 完成工单列表 Mock。type-check/lint/build 通过。T-033 → testing。
- 已派 Tester，端口避开 5288。不 Git。

## 2026-09-23 T-043 Tester PASS

- Tester 99465f3f-a470-4c74-af80-b3cf6ca48cce：模板版本后端 PASS。报告 `.sdd/test-reports/test-T-043.md`。T-043 → passed。页面联调仍在 T-049。
- 无新的可派任务。不 Git。

## 2026-09-23 T-034 交验收

- Developer 44e29dd1-18f4-47b5-823d-51ad002e6376 完成模板管理 Mock。预览 http://127.0.0.1:5288/ 。T-034 → testing。
- 已派 Tester。全量 build 被 T-033 挡住，不据此判本任务失败。不 Git。

## 2026-09-23 T-038 交验收

- Developer 40f708af-598f-4312-b69b-039aaed754bf 完成工单四态与订单/物流 Mock。自称 pytest 27 passed。T-038 → testing。
- 空地址目前始终走进程内 Mock，`.env` 里的订单中心地址还读不到。真实联调前再补配置字段。已派 Tester。不 Git。

## 2026-09-23 T-044 Tester PASS

- Tester 1cff0414-f5ca-4f95-a114-1aed883acd0f：大额金额线 PASS。报告 `.sdd/test-reports/test-T-044.md`。T-044 → passed。确认工单打标仍等 T-038 后的 T-042。
- 无新的可派任务。不 Git。

## 2026-09-23 T-037 Tester PASS

- Tester 7f0e9e6e-5778-47e1-aa49-460500158421：可见范围与用户侧召回过滤 PASS。报告 `.sdd/test-reports/test-T-037.md`。T-037 → passed。真实召回仍在 T-045。
- 知识推送仍等 T-038。无新的可派任务。不 Git。

## 2026-09-23 T-043 交验收

- Developer 5d7a390d-95cb-4871-a2c6-0bf0fec8cd9f 完成模板版本、灰度、回滚和告警。自称 pytest 14 passed。T-043 → testing。
- 已派 Tester。业务验收仍在 T-049。不 Git。

## 2026-09-23 T-044 交验收

- Developer 1aadb84a-29e7-4aa1-94d6-80e286203d8b 完成大额金额线。自称 pytest 6 passed。T-044 → testing。
- 已派 Tester。确认工单时的打标仍在 T-050。不 Git。

## 2026-09-23 T-031 PASS，T-037 交验收

- Tester f2005d36-a011-4cba-b0e2-bb1cd8ebbae4：客服填单 Mock PASS。报告 `.sdd/test-reports/test-T-031.md`。T-031 → passed。
- 两条 Mock 经验已写入 `.sdd/experience.md`。
- Developer 1cf47874-1353-4439-ba97-05f85b70fb4c 完成可见范围与召回过滤。写入范围补上 `db/models.py`、`db/session.py`。T-037 → testing。已派 Tester。不 Git。

## 2026-09-23 T-029 Tester PASS，派管理端两页

- Tester f97c700b-d7d8-4a45-9a48-eec5b4f8001f：角色登录 Mock 通过。报告 `.sdd/test-reports/test-T-029.md`。T-029 → passed。真实登录仍在 T-048。
- 已派 T-033 d0eb8a07-f9dc-4872-90a4-119d4cbe3422、T-034 44e29dd1-18f4-47b5-823d-51ad002e6376 替换占位页。不 Git。

## 2026-09-23 T-032 Tester PASS

- Tester 7244e708-62b6-412b-a026-935c046b381c：员工端进度 Mock 通过。报告 `.sdd/test-reports/test-T-032.md`。T-032 → passed。真实回写仍在 T-052。
- 无新的可派任务。不 Git。

## 2026-09-23 T-029 交验收

- Developer 713e9943-c50d-4042-a0dc-ef620af2487c 完成角色登录 Mock。T-029 → testing。工单列表和模板页仍等本任务 PASS 后再派 T-033/T-034。
- 已派 Tester。不 Git。

## 2026-09-23 T-036 Tester PASS，派后端四件

- Tester 27d7dfea-a515-474b-af1e-e2efe7b8c2cf：十角色后端 PASS。报告 `.sdd/test-reports/test-T-036.md`。T-036 → passed。业务验收仍在 T-048。
- 已派 Developer：T-037 1cf47874-1353-4439-ba97-05f85b70fb4c；T-038 40f708af-598f-4312-b69b-039aaed754bf；T-043 5d7a390d-95cb-4871-a2c6-0bf0fec8cd9f；T-044 1aadb84a-29e7-4aa1-94d6-80e286203d8b。不派联调。不 Git。

## 2026-09-23 T-030 Tester PASS

- Tester 804bc62a-d0d4-4dcd-a139-bddd5288175d：知识库可见范围 Mock 通过。报告 `.sdd/test-reports/test-T-030.md`。T-030 → passed。业务验收仍在 T-045。不代替 T-035 门禁。
- 下一件开发仍等 T-029 或 T-036。不 Git。

## 2026-09-23 T-031 交验收

- Developer 623b66f3-d6e2-4aa9-8602-651815d5c7d1 完成客服四态、订单候选与润色对比 Mock。T-031 → testing。
- 两条经验候选等 Tester 核对后再决定是否落盘。已派 Tester。不 Git。

## 2026-09-23 T-032 交验收

- Developer 47fccda4-9e65-44d4-99f5-259a055699de 完成员工端进度 Mock。预览 http://127.0.0.1:5216/ 。T-032 → testing。
- 已派 Tester。不 Git。

## 2026-09-23 T-036 交验收

- Developer f957b05a-76f2-4632-825f-86ead444fabe 完成十角色后端。自称 pytest 103 passed。T-036 → testing。
- 已派 Tester。不 Git。

## 2026-09-23 T-030 交验收

- Developer 0f6c08e0-9b87-49e6-8a4b-bf987db5ecb9 完成知识库可见范围 Mock。T-030 → testing。
- 已派 Tester。其余 T-029、T-031、T-032、T-036 仍在开发。不 Git。

## 2026-09-23 派发首批可并行开发

- Planner 6c194bda-f9dc-401d-b501-1ad553e28332：T-029～T-052。唯一门禁 T-035。交付仍为 T-028。
- 已派 Developer：T-029 713e9943-c50d-4042-a0dc-ef620af2487c；T-030 0f6c08e0-9b87-49e6-8a4b-bf987db5ecb9；T-031 623b66f3-d6e2-4aa9-8602-651815d5c7d1；T-032 47fccda4-9e65-44d4-99f5-259a055699de；T-036 f957b05a-76f2-4632-825f-86ead444fabe。
- 不派联调与交付。不 Git。

## 2026-09-23 用户说开发

- ui-style → Confirmed。沿用 execution_mode=automatic。
- 已派 Planner 6c194bda-f9dc-401d-b501-1ad553e28332 做增量任务，保留 T-001～T-028 历史。不改业务代码，不 Git。

## 2026-09-23 技术方案写完，进入界面调整

- Solution Designer 062d6f70-a818-4398-9a08-1ea2be5fe8de 完成。tech-spec 按用户「可以直接开发」且无未决取舍，标为 Confirmed。API-013～017 重写，新增 API-018～035、EXT-003～007。
- PRD 坐席时序图已补 API 编号。ui-style 回 Draft，补工单四态色和管理端页面范围，等界面确认后再派 Planner。不 Git。

## 2026-09-23 用户定稿并要求开发

- PRD status → Confirmed。用户说可以直接开发。
- tech-spec 仍为 Draft。Solution Designer 062d6f70-a818-4398-9a08-1ea2be5fe8de 从 00:43 卡住，tech-spec 停在 00:06。07:26 已中断并续写。界面与开发未开始。不 Git。

## 2026-09-23 VIP 物流二级升级的四种立即升级

- 默认仍是一级后再等 2 小时。威胁投诉或曝光、用户拒绝一级方案、一级处理人无法处理、距离 VIP 时限不足 2 小时，这四种立即升到二级。
- 未再给出按异常类型调整的其他小时数。PRD 仍为 Draft，等用户确认可以定稿。不派开发，不 Git。

## 2026-09-23 VIP 物流二级升级默认再等 2 小时

- 不涉及赔付时，一级后再等，默认 2 小时，仍未完成升到二级。用户说明这 2 小时要按场景调整，且有前置条件。场景表和前置条件尚未给出，不写死成一律 2 小时。
- PRD 保持 Draft。不派开发，不 Git。

## 2026-09-23 用户确认 VIP 物流异常时限和两级升级

- 六种异常的 VIP 时限为普通的一半，预警分别为超时前 3 小时、8 小时或 1.5 小时。一级给物流售后专员或高级客服；涉及赔付同时给客服主管或售后负责人。不自动关闭。
- 「一级之后仍超时」的第二段时长未给。PRD 保持 Draft。不派开发，不 Git。

## 2026-09-23 用户确认四类 VIP 预警提前量

- 修改地址/开发票：普通时限前 30 分钟，VIP 30 分钟时限前 10 分钟。退换货、投诉：普通时限前 4 小时或 8 小时，VIP 4 小时时限前 1 小时。费用争议：普通时限前 4 小时，VIP 2 小时时限前 30 分钟。
- 物流异常 VIP 的升级对象和再提前量仍未定。PRD 保持 Draft。不派开发，不 Git。

## 2026-09-23 VIP 单独队列且预警早于普通

- PRD 仍为 Draft。VIP 不自动关闭，不与普通工单同一队列，超时只能升级给在岗的指定角色。
- 未写死：各类 VIP 比普通早多少预警；物流异常 VIP 升级给谁、预警再提前多少。不派开发，不 Git。

## 2026-09-23 用户给出 VIP 时限和物流异常分档

- PRD 仍为 Draft。已写入修改地址、退换货、费用争议、投诉的普通/VIP 时限和升级对象，以及物流六种异常的预警和关闭等待。开发票沿用修改地址。物流 VIP 不另造更短小时数，只不自动关闭。
- 不派开发，不 Git。用户若确认物流 VIP 维持普通时限，即可把 PRD 定为 Confirmed。

## 2026-09-23 用户确认分配、时效、打标和两类工单字段

- PRD 仍为 Draft。已写入混合分配、售后专员与主管、分类型预警后关闭、三层紧急程度、费用争议与物流异常字段。出行改为物流异常工单，不另设旅行业务线。
- 仍待数字：VIP 各类型缩短后的时限，物流异常的处理时限和关闭等待。不派开发，不 Git。

## 2026-09-23 用户确认订单匹配、知识分级、模板运营和工单列表

- PRD 仍为 Draft。已写入：订单中心一条自动填、多条候选、零条缺失；知识底座一套、三级可见范围；REQ-009 模板版本/5% 灰度/回滚/5000 条评测；REQ-010 工单列表与状态；REQ-011 仓储、财务和会话回写。
- 未定稿，不派开发：认领方式、超时关闭时长、紧急程度由谁判定、费用争议和出行的字段、行程中与售前售后的差别。
- 不 Git。tech-spec 继续 Draft。

## 2026-09-22 用户补充填单、检索、润色与模板

- 不视为 Mock 门禁通过。不派 T-025～T-028，不改任务状态，不 Git。
- PRD 回 Draft：REQ-005～008 改为增量槽位、置信/冲突、知识溯源与搜索、润色对比与合规、按场景选用模板。新增 AC-044～AC-053。冲突改为不覆盖。
- tech-spec 回 Draft，旧 API 仅备查。四项范围待用户确认：外部订单关联、两套知识库、模板灰度评测、确认后是否单独队列。

## 2026-09-22 用户要求补充电商知识文档

- 不视为 Mock 门禁通过。T-021 user_gate 仍为 awaiting_user。不派 T-025～T-028。不 Git。不调用百炼。
- 已写入 `docs/knowledge-samples/`：服饰退换、3C 质保、两侧 FAQ、改地址、发票、投诉、配送时效。服饰与 3C 分开，不写死退款金额和回复时限。
- 预览知识库种子改为上述文档（`frontend/src/mocks/documents.ts`，存储键 v5）。真实后端 8099 未启动，尚未入库。

## 2026-09-22 Planner 返回，并行派 T-019/020/022/023

- Planner d3529027-0a8c-4fa9-ad57-0745aa3115ba：T-019～T-028。本轮 Mock 门禁 T-021。交付 T-028。
- 已派 Developer：T-019 4a100ef4-e232-4a27-99d2-d2ac495fce3e；T-020 daec6fd7-716a-46ea-810c-01923254966c；T-022 216d07ba-5543-4ad2-b9fb-de788596311d；T-023 496d146d-e430-47a2-bb24-137fa9ec5f59。
- T-022 Tester 49a50c2e-50fd-46b1-86bf-fb5f50a5bf9c PASS（后端阶段）。报告 test-T-022.md。T-022 → passed。
- T-020 Tester 5ca5053c-2b47-4e1c-9092-36d532880749 PASS（Mock）。报告 test-T-020.md。T-020 → passed。
- T-021 Tester 19eb8e7e-dc92-4dbd-ae24-92bcb1f93d7d PASS（Mock）。报告 test-T-021.md。T-021 → passed。user_gate → awaiting_user。停止联调派发。backend/.env 百炼键仍为非占位，不要求重填。待用户认可本轮 Mock。
- T-020 仍在验收。T-022、T-023 仍在开发。T-021 等 T-020。不 Git。

## 2026-09-22 用户确认客服端界面，派 Planner

- ui-style → Confirmed。沿用 execution_mode=automatic。
- 派 Planner 增量任务（T-019 起），保留 T-001～T-018 passed。不改业务代码，不 Git。实例 d3529027-0a8c-4fa9-ad57-0745aa3115ba。

## 2026-09-22 技术方案确认 D-006=B D-007=A，进入阶段 B

- 用户确认 1.B、2.A。decisions / tech-spec → Confirmed。
- ui-style 回 Draft：UI-03 增加填单、知识推送、润色；原型 03-agent 与 shared 已改。待用户确认界面。
- 未改业务代码。不派 Planner。

## 2026-09-22 Solution Designer 返回 Draft 方案，待确认 D-006/D-007

- 实例 2c81ed98-2eb0-41be-a277-c07bc380bb65：tech-spec 已按电商标签 v2.0 + API-013～017 写入，status Draft。
- 未转人工不建单。建议 D-006=B、D-007=A，尚未用户确认。确认前不标 Confirmed，不进阶段 B，不改业务代码。

## 2026-09-22 PRD 定稿，恢复 Solution Designer

- 用户确认标签体系与未转人工电商口径可定稿。PRD → Confirmed。
- 恢复 Solution Designer 2c81ed98-2eb0-41be-a277-c07bc380bb65：按 tag-taxonomy v2.0 修订 REQ-001，并完成 REQ-005～008 七层增量。不改业务代码，不派开发。

## 2026-09-22 未转人工改为电商，PRD 回 Draft

- 用户确认：未转人工也变为电商领域。中断 Solution Designer 2c81ed98-2eb0-41be-a277-c07bc380bb65。
- 已改 PRD REQ-001 / AC 示例与流程图；`docs/tag-taxonomy.json` 换成电商对象与诉求。不改业务代码。
- 待用户确认标签体系后，PRD 再 Confirmed，并重派技术方案（含 REQ-001 标签口径 + 客服端增量）。

## 2026-09-22 用户确认客服增量，PRD Confirmed，派 Solution Designer

- 网页端内部使用；问题领域为电商板块。
- 转人工后按电商工单；工单只存本系统；售前只做知识推送+润色、不建销售单；业务线坐席手选可改。未转人工仍为 IT 问答。
- 新增 AC-043。PRD → Confirmed。tech-spec 回 Draft（须补 REQ-005～008）。
- 派 Solution Designer 写七层方案增量。不改业务代码，不派开发。实例 2c81ed98-2eb0-41be-a277-c07bc380bb65。

## 2026-09-17 T-014 Tester PASS，本轮任务全部通过

- Tester a9b9d1e3-7a78-4ec3-9807-e0e7c6f59d1e：页面功能导航通过。DEL-001～005。报告 `.sdd/test-reports/test-T-014.md`。T-014 → passed。
- T-001～T-018 均为 passed。业务 AC 已由 T-010～T-013 真实链路覆盖。未提交 Git。

## 2026-09-17 T-014 Developer 返回，派 Tester

- Developer 7643d5e4-a78b-4867-894f-7ea8a1a6cfb7：已生成 `docs/project-console.html`、`docs/project-map.json`，README 补充打开/刷新。T-014 → testing。
- 派 Tester a9b9d1e3-7a78-4ec3-9807-e0e7c6f59d1e 验 DEL-001～005。不改业务代码。不授权 Git / 百炼。

## 2026-09-17 T-013 Tester PASS，派 T-014

- Tester 36b6c5a5-dd89-4260-bf76-8a1c7fb246b1：转人工真实链路通过。AC-005～008。报告 `.sdd/test-reports/test-T-013.md`。T-013 → passed。
- 派 T-014 Developer 7643d5e4-a78b-4867-894f-7ea8a1a6cfb7 生成 `docs/project-console.html`。不改业务代码。不授权 Git / 百炼。

## 2026-09-17 T-012 Tester PASS，派 T-013

- Tester ebae5577-1069-445d-ba92-41b618748042：员工提问全链路通过。AC-001/002/011～016/019～022。报告 `.sdd/test-reports/test-T-012.md`。T-012 → passed。
- T-013 write_scope 为空，跳过 Developer，派 Tester 36b6c5a5-dd89-4260-bf76-8a1c7fb246b1。T-014 等 T-013。AC-007 允许最小次数百炼。不授权 Git。

## 2026-09-17 T-011 Tester PASS，派 T-012

- Tester af3614ba-6fef-494c-8079-e4b33e75a14f：知识入库真实链路通过。AC-003/004/017/018/023/024/027/028/029。报告 `.sdd/test-reports/test-T-011.md`。T-011 → passed。
- T-012 write_scope 为空，跳过 Developer，派 Tester ebae5577-1069-445d-ba92-41b618748042。T-013 等 T-012（共用 5199/8099/SQLite）。允许本任务最小次数百炼。不授权 Git。

## 2026-09-17 T-010 Tester PASS，派 T-011

- Tester 570fd357-d23b-49f8-be16-c8211e615263：真实登录/退出通过。AC-009/010/025/026。报告 `.sdd/test-reports/test-T-010.md`。T-010 → passed。
- T-011 write_scope 为空，跳过 Developer，派 Tester af3614ba-6fef-494c-8079-e4b33e75a14f。T-012/T-013 等 T-011（共用 5199/8099/SQLite）。
- 本轮 T-011 允许最小次数百炼 Chat/Embedding 以验入库至 ready 及提问。不授权 Git。

## 2026-09-17 T-009 Tester PASS

- Tester 25adc6d3-87d1-448f-98c4-382d98085c2c：API-010 后端阶段通过。TC-01～04。pytest 24 passed。报告 `.sdd/test-reports/test-T-009.md`。T-009 → passed。
- 业务 AC 仍由 T-012/T-013。未打真实百炼。
- T-010 Tester 570fd357-d23b-49f8-be16-c8211e615263 仍在途。不派 T-011～T-014（依赖 T-010）。

## 2026-09-17 用户确认 Mock，门禁放行

- 用户确认界面可以（http://127.0.0.1:5199/）。user_gate.status=passed；user_confirmation 已记录。
- 必需服务顶层状态改为 confirmed（配置齐备，连通性仍由联调 Tester 验证）。
- 已改 `test_routes_do_not_use_websocket_or_llm`：保留无 WebSocket/无直连 LLM 断言，允许 API-010 `/messages`。
- T-010 write_scope 补 `frontend/.env`（关 Mock）。不派 Git。T-009 验收用假客户端，不发起百炼付费调用。
- 已派 T-009 Tester 25adc6d3-87d1-448f-98c4-382d98085c2c；T-010 Developer fef747ba-8267-4b38-96af-49606a121f2e（并行，写入范围不冲突）。不派 T-011～T-014（等 T-009/T-010）。

## 2026-09-17 T-010 Developer 返回，派 Tester

- Developer fef747ba-8267-4b38-96af-49606a121f2e：`VITE_USE_MOCK=false`；真实 API-001/002 401/200 自验通过；页面点击未做。T-010 → testing。
- 派 T-010 Tester 570fd357-d23b-49f8-be16-c8211e615263（浏览器登录/退出）。T-009 Tester 仍在途。不派 T-011。不授权 Git / 百炼付费调用。

## 2026-09-17 用户要求配置 backend/.env

- 已生成 `backend/.env`（gitignore）：`secret_key` 已生成；`shared_password` 与演示登录一致；`llm_api_key` 非占位（复用本机已有百炼配置，值不入库）。
- 已把本地库共享账号哈希对齐到演示密码。配置记录写入 T-017 `configuration_confirmation`。
- user_gate 仍 awaiting_user：用户尚未明确认可 Mock。不关 `VITE_USE_MOCK`，不派 T-009 Tester / 联调，不授权 Git / 百炼付费。

## 2026-09-17 T-017 Tester PASS，前端门禁 awaiting_user

- Tester 5aade0a7-c0c3-4f64-a1d0-f05313997652：上传三种格式 Mock 与跨页抽检通过。报告 `.sdd/test-reports/test-T-017.md`。T-017 → passed。
- user_gate.status=awaiting_user。停止新派发（含 T-009 Tester、联调 T-010～T-014）。
- 预览：http://127.0.0.1:5199/ Mock 开。尚无 `backend/.env`。待用户认可 Mock 并填写百炼等配置后才恢复。

- Developer 4036429f-f34f-4761-a9c2-f09e1d53754e：上传 md/txt/pdf Mock、原文件名、800/160。T-017 → testing。
- 派 T-017 Tester 5aade0a7-c0c3-4f64-a1d0-f05313997652（最后前端，通过后门禁 awaiting_user）。不授权 Git / 百炼付费。

- Tester f73dd610-2cee-4e32-b3ae-17372af36059：convert-then-chunk / 重叠 160 / 无 Key 失败收口通过。报告 `.sdd/test-reports/test-T-018.md`。T-018 → passed。
- 经验不新增。T-017 Developer 仍在途。不派联调（等 T-017 门禁）。不授权 Git / 百炼付费。

- Tester 69e1656f-cde0-4b5b-9beb-549021b411f0：列表筛选 Mock 通过。报告 `.sdd/test-reports/test-T-015.md`。T-015 → passed。
- 筛选+轮询竞态未复现，经验不新增。
- 派 T-017 Developer（上传格式 Mock + 唯一 user_gate）。T-018 Tester 仍在途。不授权 Git / 百炼付费。

- Developer e36e5589-dd85-47af-a543-af4f58adf274：API-003 三种格式、先转 Markdown、重叠 160。T-018 → testing。
- 派 T-018 Tester f73dd610-2cee-4e32-b3ae-17372af36059。T-015 Tester 仍在途。不派 T-017。不授权 Git / 百炼付费。

- Developer 01514f7d-28bf-48b9-a4a8-0b75823743d6：列表筛选 Mock 已补齐。T-015 → testing。
- 派 T-015 Tester。T-018 Developer 仍在途。不派 T-017（依赖 T-015）。不授权 Git / 百炼付费。
- 经验建议（筛选与轮询竞态）待 Tester 复验后再落盘。

## 2026-09-17 界面确认后规划并开工

- 用户确认 ui-style / 原型；status 已 Confirmed。
- Planner 1b7e37ee-d3b0-448b-af4f-02e73ee28aee：新增 T-017（前端上传格式 Mock + 唯一 user_gate）、T-018（后端 convert-then-chunk，重叠 160）。T-015 移走门禁，保持 in_progress。T-011 扩入 AC-029。
- 派 T-015 Developer 01514f7d-28bf-48b9-a4a8-0b75823743d6（回收此前未返回实例）、T-018 Developer e36e5589-dd85-47af-a543-af4f58adf274。可并行。
- 不派 T-009 Tester（仍 testing，T-008 `/messages` 断言冲突未解）。不授权 Git / 百炼付费。

## 2026-09-17 上传格式增量进入阶段 B

- 用户确认 tech-spec，status 已改为 Confirmed。
- ui-style 改回 Draft：UI-04 上传接受 md/txt/pdf，切块说明先转 Markdown、重叠 160 字。
- 原型 04-knowledge / shared/app.js / styles.css 已同步。浏览器自动化不可用，未做实机点击验收。
- 待用户确认本轮界面后派 Planner。

## 2026-09-17 上传格式增量技术方案 Draft

- 用户确认重叠 20%（800 字上限时 160 字）。PRD 已 Confirmed（AC-003/004/023/024/029）。
- tech-spec 改回 Draft：API-003 接受 `.md`/`.txt`/`.pdf`；请求期 PDF 抽不出文字则 400 不建行；后台先转 Markdown 再切块；`chunk_overlap_chars=160`。不写 decisions.md。
- 待用户确认本轮 tech-spec 后进入阶段 B（上传控件与切块说明），再 Plan。

## 2026-09-14 T-016 Tester PASS

- Tester 0c10d550-571c-4899-92f8-fdbaf5a6b6f5：API-004 过滤/排序/非法 400 通过。报告 `.sdd/test-reports/test-T-016.md`。T-016 → passed。
- 不派联调（T-015 门禁仍 pending）。T-015 Developer 仍在途。

## 2026-09-14 T-016 Developer 完成，派 Tester

- Developer 72698ed8-4f1b-42bf-9a85-af732e7b21cf：API-004 可选 ingest_status 已实现。pytest test_documents 13 passed。T-016 → testing。
- 派 T-016 Tester。T-015 Developer 仍在途。不授权 Git / 百炼付费。

## 2026-09-14 知识库列表增量开工

- 用户确认 PRD AC-027/AC-028、tech-spec API-004 可选 ingest_status、ui-style UI-04 与原型 04-knowledge。
- Planner cc9de703-cfae-4fe4-9d65-b0bc9ed6efba：新增 T-015（前端 Mock）与 T-016（后端过滤）；user_gate 从 T-005 迁至 T-015，status=pending。
- 派发 T-015、T-016 Developer 并行。不授权 Git / 百炼付费。T-009 保持 testing，本轮不派 Tester（先完成用户指定的列表增量）。
- 预览：http://127.0.0.1:5199/ Mock 开，账号 it-help / it-help123。

## 2026-09-12 推进模式切换

- 用户要求：将 `step_by_step` 切换为 `automatic`。
- 切换前 step_gate：kind=task_review，task_id=T-001，status=pending，user_confirmation=null；无 changes_requested。
- 切换后：`execution_mode=automatic`。不伪造 step_gate.passed。前端 Mock 门禁仍在 T-005，不能绕过。
- 当时在途：T-001 status=testing（Developer 086ac587-98be-4e4d-933b-2027e8982911 已返回，待 Tester）；T-006 依赖已满足且写入 backend/，与 frontend 无冲突，并行派发。
- 已有开发授权继续有效。本次切换不授权 Git 提交/推送，不授权百炼付费调用。

## 2026-09-13 T-009 Developer 收尾，Tester 等待门禁

- Developer dd0a525e-3657-4173-87fa-ed78ac92fcb3：API-010 已实现。test_qa 15 passed。T-008 `test_routes_do_not_use_websocket_or_llm` 仍禁止 `/messages`，与本任务冲突。T-009 → testing。
- user_gate 仍 awaiting_user：不派 T-009 Tester，不派联调。放行后先改该断言再验收。

## 2026-09-13 T-005 Tester PASS，前端门禁 awaiting_user

- Tester e4003a14-bb1b-4e52-8351-5233dbc01c6f：四页 Mock 主流程通过。报告 `.sdd/test-reports/test-T-005.md`。T-005 → passed。
- `user_gate.status=awaiting_user`。停止新派发（含 T-009 Tester、T-010 联调）。T-009 Developer 仅收尾当前范围。
- 预览：http://127.0.0.1:5199/ Mock 默认开，账号 it-help / it-help123。
- 尚无 `backend/.env`。待用户认可 Mock，并填写百炼等配置后才恢复。

## 2026-09-13 T-007 Tester PASS，派发 T-009

- Tester 2f9023ea-89e6-4288-bdf3-6064bf435938：入库 API 通过。报告 `.sdd/test-reports/test-T-007.md`。T-007 → passed。
- 经验已写入：Markdown 父标题无正文不落空块。
- T-007/T-008 均 passed，派发 T-009 Developer（API-010）。T-005 仍在途。不派 T-010 联调（等 T-005 门禁）。

## 2026-09-13 T-008 Tester PASS

- Tester 0833cce2-88fd-41ac-a396-6550dde05f36：会话 API-007/008/009/011/012 通过。报告 `.sdd/test-reports/test-T-008.md`。T-008 → passed。
- 经验已写入 `.sdd/experience.md`：异步 Session 读关系须 selectinload；写子行后 expire 已加载集合再按 id 查询。
- T-009 仍等 T-007 验收。不派联调。

## 2026-09-13 T-004 Tester PASS，派发 T-005

- Tester af45bd0e-56ce-463c-a102-33930f22796a：客服端 Mock 通过。报告 `.sdd/test-reports/test-T-004.md`。T-004 → passed。
- T-001～T-004 均 passed，派发 T-005 Developer 做跨页 Mock 收口。user_gate 仍 pending，等 T-005 Tester PASS 再停派并交用户。
- T-007 Developer、T-008 Tester 继续收尾，不派 T-009/联调。

## 2026-09-13 T-003 Tester PASS

- Tester 0361b20d-7643-4701-9e31-c6684e6cf2bc：知识库 Mock 浏览器实测通过。报告 `.sdd/test-reports/test-T-003.md`。T-003 → passed。
- T-005 仍等 T-004 验收。

## 2026-09-13 T-002 Tester PASS

- Tester ebead7ea-73f6-4e1d-8ace-468fee491e7a：员工端 Mock 浏览器实测通过。报告 `.sdd/test-reports/test-T-002.md`。T-002 → passed。
- T-005 仍等 T-003、T-004 验收。不伪造用户门禁。

## 2026-09-13 连接中断恢复

- 五个在途实例 Connection failed：T-002/T-003/T-004 Tester，T-007/T-008 Developer。旧实例视为已终止。不消耗 retry_count。
- 前端：T-002～T-004 保持 testing，续派 Tester 做浏览器实测（此前未出报告）。
- 后端：T-007 保持 in_progress，documents.py 仍为空路由，续写剩余 write_scope；T-008 代码已落盘，续完 pytest 自验。
- 写入范围仍互不交叉。不伪造 T-005 门禁。不授权 Git / 百炼付费。

## 2026-09-12 再次确认切换 + 中断恢复

- 用户再次要求切到 automatic：字段已是 `automatic`，不重复改模式，不伪造 passed。
- 上次并行派发被中断：T-001 Tester 未返回；T-006 Developer 未完成（仅有部分 backend 文件）。旧实例视为已终止。
- 恢复：T-001 保持 testing 重派 Tester；T-006 保持 in_progress 重派 Developer 续写剩余范围。写入范围仍互不交叉。
