# T-046 验收报告（主对话降级模式，非独立验收）

- 任务：T-046 联调：订单匹配、增量槽位、费用争议与物流轨迹
- 总结果：**PASS（自验）**
- 验证方式：沿用用户选的「c」与「2.A」，开发与验收由同一主对话完成，**不是独立 Tester 复核**（developer/tester 子智能体固定的模型用量耗尽）。
- 路径：真实联调。`VITE_USE_MOCK=false`，坐席操作在真实页面上完成，经 Vite 代理打到 8114。抽取与润色走真实百炼。订单中心、物流轨迹没有真实凭证，按任务说明用适配器替身：后端用真实的 `HttpOrderAdapter` / `HttpLogisticsAdapter` 经 HTTP 调用隔离的替身服务 8134，没有用进程内 Mock，也没有用前端 Mock。
- 报告不含口令、Key、Token。

## 验证环境

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5224/ ，`VITE_USE_MOCK=false`、`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8114` |
| 后端 | http://127.0.0.1:8114/ ，`.sdd/tmp-t046/t046_serve.py`（内存中把订单中心、物流适配器指向 8134，不写 `.env`） |
| 订单中心 / 物流替身 | http://127.0.0.1:8134/ ，`.sdd/tmp-t046/t046_ext_mock.py`，由 `ext_state.json` 切换一条 / 两条 / 零条 / 503 失败、已签收 / 503 查不到。每次调用记在 `evidence/ext_calls.jsonl` |
| 库 | `backend/data/t046.db`（新建；未碰 `Customer_Service.db` 及其他任务库） |
| 浏览器 | headless Chrome CDP 9564，脚本 `.sdd/tmp-t046/t046_browser.mjs` |
| 证据 | `evidence/t046-browser-evidence.json`（最后一轮）、`t046-browser-evidence-run1.json`（前一轮）、同目录截图 |
| 未碰端口 | 8099 / 8112 / 8113 / 5175 / 5199 / 5222 / 5223 |

会话都由员工账号经真实 API 建好并转人工，坐席的选类型、手改、选候选、解冲突、上传截图、确认和润色都在页面上完成。

## 逐项结果（最后两轮均 24/24 PASS）

| 检查 | 结果 | 实际 |
| --- | --- | --- |
| 前端未用 Mock | PASS | `isMockEnabled()=false`，页面无 [Mock] |
| AC-044 一条命中 | PASS | 订单号 `T046-ORD-A001`，状态已填，`order_match=auto_filled`，与替身返回的那一条一致，页面同值 |
| AC-044 查询条件 | PASS | 替身收到 `user_key="2"`（员工用户 id，不是会话 id）、`time_range="昨天"`、`keywords=["蓝色手机"]` |
| AC-044 商品与原因 | PASS | 商品已填（含蓝色手机），退换原因缺失 |
| AC-045 增量补原因 | PASS | 员工说「因为屏幕有划痕」后退换原因含划痕；商品、订单号值和状态都没变 |
| AC-046 手改不被覆盖 | PASS | 坐席把商品改为「黑色手机」（agent_edited）；员工说「是蓝色的」后仍是黑色手机、标冲突，新值含蓝色，页面显示冲突 |
| AC-046 坐席选定才变 | PASS | 点「改用新值」后商品变为蓝色，状态 agent_edited |
| AC-047 确认后不自动变 | PASS | 确认后有工单号；员工再说「原因是电池续航不行，金额改成500元」，12 秒后订单号、商品、原因、金额都没变 |
| AC-047 手改与改类型 | PASS | 确认后手改意图摘要 200 且为 agent_edited；PATCH 类型 409「工单已确认，不能更改工单类型」；类型下拉禁用 |
| AC-057 两条候选 | PASS | 订单号 `candidate`、值为空，两笔 B001/B002 都列为候选按钮，均未预选 |
| AC-057 选定后已填 | PASS | 点 B002 后订单号为 `T046-ORD-B002` |
| AC-058 零条 | PASS | 订单号缺失、无候选，字段里无任何单号样式的值 |
| AC-058 查询失败 | PASS | 替身返回 503；`order_match=query_failed`，`query_message=暂未查到`，页面可见「暂未查到」，无编造单号 |
| AC-083 抽取 | PASS | 真实抽取得到订单号、商品、争议类型 price_protect、主张 200、核算 120、差异原因。公共字段「相关金额」原话没有，由坐席在页面补为 200 |
| AC-083 缺图不能确认 | PASS | 其余都齐时 `confirm_blockers=["attachments"]`，确认按钮禁用，证据截图显示缺失；直接 POST confirm 409「费用争议需要证据截图」 |
| AC-083 金额可见 | PASS | 页面字段可见主张 200、核算 120 与差异原因 |
| AC-083 补图后确认 | PASS | 页面上传截图 200，附件列表 1 条，可确认，确认后有工单号 |
| AC-083 润色无新编金额 | PASS | 带金额原稿和不带金额原稿各润色一次，润色稿都没有会话和原稿以外的金额 |
| AC-085 已签收不填责任方 | PASS | 轨迹 ok/signed；责任方、补偿缺失；意图摘要为「用户称快递丢失，未收到货」 |
| AC-085 已签收说明 | PASS | 页面与接口 `note`：「用户称快递丢失；物流轨迹显示已签收。丢件尚未核实，不能据此判断责任方。」 |
| AC-085 查不到轨迹 | PASS | 替身 503 → `query_status=failed`；责任方、补偿缺失且输入框禁用；PATCH 责任方 409「物流轨迹暂未核实…」 |
| AC-085 查不到说明 | PASS | 页面与接口 `note`：「物流轨迹暂时查不到，暂不能判断责任方和补偿方案。」 |
| AC-085 回复不编造责任方 | PASS | 润色稿只说正在核实、暂未查到轨迹，没有写由谁负责 |
| 真实接口 | PASS | API-013/014/015/018 真实调用；订单中心、物流都经 HTTP 适配器打到替身，覆盖 200 与 503 |

## 发现并修复的产品缺陷

1. **证据截图在真实环境根本传不上去（AC-083）。**
   - 现象：页面上传一律 400「请重新上传」，费用争议永远确认不了。
   - 根因：`api.ts` 默认 `Content-Type: application/json`。axios 1.x 遇到这个头会把 `FormData` 转成 JSON，文件丢失。文档上传、评测集上传都覆盖了这个头，工单附件漏了。前端 Mock 直接从 `FormData` 取文件，所以门禁阶段没暴露。
   - 修复：`frontend/src/services/ticketService.ts` 上传时同样覆盖 `Content-Type`。
2. **订单中心收不到「昨天」（AC-044）。**
   - 现象：替身收到 `time_range=null`。
   - 定位：真实探针显示模型在退换货抽取里对「昨天」3/3 输出 null（费用争议的「上周」正常）。
   - 修复：`extract_common.md` 把时间规则写明为「说到购买、下单或收货的时间时原样抄写，用于按时间查订单」。修复后探针「昨天」5/5、「上周」5/5（`evidence/t046-extract-probe.json`）。
3. **真实环境看不到物流核对说明（AC-085）。**
   - 现象：前端会显示 `logistics_snapshot.note`，但后端不返回这个字段，已签收或查不到时页面什么都不说。
   - 修复：
     - `LogisticsSnapshotPublic` 增加 `note`。
     - `ticket.py` 按轨迹结果生成说明：查不到时说明不能判断责任方；已签收且用户称丢件时同时写明两者并注明未核实。
     - `extract_logistics_exception.md` 要求意图摘要用「用户称……」记录用户说法。
     - 单测补 `note` 断言，新增 `test_logistics_lost_but_signed_note_states_both_without_party`。

## 过程中修正的验证脚本问题

- 登录响应不含用户 id，改为校验 `user_key` 是数字用户 id 且不是会话 id。
- CDP 按文件路径上传在中文用户目录下不可靠，改为在页面里构造 `File` 触发同一个上传控件。
- 润色「保留原稿 200 元」不属于 AC-083（AC-083 只要求不出现新编赔付金额），移为观察项，见下。

## 观察项（不影响本任务判定）

- **润色会丢掉原稿里的主张金额。** 原稿写了「您主张退差价200元，平台核算可退120元」，两轮润色稿都只保留了 120 元。这属于 T-047 的 AC-050（原稿已有的金额必须保持一致），T-047 联调时需要重点验，大概率要再收紧润色提示词。

## 回归

- `test_ticket_extract.py`、`test_tickets.py`、`test_ticket_attachments.py`：38 passed，1 failed。失败的是已知过期断言 `test_confirm_then_patch_type_409_fields_and_line_ok`（期望 urgency 为 None）。
- 后端全量单测 197 passed、2 failed。两条失败都是与本任务无关的已知过期断言：上面的 urgency 断言，以及 `test_qa.py::test_fallback_reply_comes_from_config_only`（断言 qa.py 不含「工单」）。
- `ruff` 通过；前端 `tsc -b --noEmit`、`eslint` 通过。

## 未验与限制

- 本次修复改了 `extract_common.md` 和 `ticket.py`，两者与 T-026 共用。抽取相关单测全部通过，但 T-026 的浏览器脚本没有重跑。
- 非独立验收。待 Tester 子智能体可用时可再独立复验。
- 订单中心、物流是按 tech-spec HTTP 形态写的替身，不是真实厂商接口；真实凭证到位后需要再联调一次。
- 未写经验库（需 Tester 复验）。
