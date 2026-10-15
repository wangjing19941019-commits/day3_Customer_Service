# T-025 Tester 报告

- 任务：T-025 联调：电商知识问答变更验收
- 总结果：**PASS**
- 路径：真实联调（`VITE_USE_MOCK=false`，员工端操作经 Vite 代理打到 8111，再经百炼 Chat/Embedding）。未用 Mock，未用 T-012 旧 IT 证据。Developer 自验不算通过。
- 报告不含口令、Key、Token。

## 验证环境

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5221/ ，进程启动命令带 `VITE_USE_MOCK=false`、`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8111` |
| 后端 | http://127.0.0.1:8111/ ，**未重启** |
| 进程 | uvicorn pid **25420**，父进程跑 `.sdd/tmp-t025/t025_serve.py`，启动打印 `T025_PROCESS_MARKER=t025-isolation-8111` |
| 库 | `backend/data/t025.db`（只读核验；未碰 `Customer_Service.db` / `t045.db` / `t052.db`） |
| 启动指纹 | `T025_QA_SHA16=3dc30c1e55914fb4`（磁盘仍一致）；`T025_RETRIEVE_SHA16=05dd24ee188dad98` |
| 磁盘 retrieve.py | 现哈希 `e575872d05b29cfa`（mtime 晚于 25420 启动）。按派发要求**不重启 8111**，本轮验的是 **25420 内存里的自验版 retrieve.py（05dd24ee188dad98）** |
| 知识 | 星海 X1（3C，`user_visible`，ready）；云棉连衣裙退换货（服饰，`user_visible`，ready，已填生效期） |
| 账号 | `employee`（口令来自 `backend/.env` 的 `shared_password`，不写值） |
| 未占用 | 8099 / 8108 / 8109 / 8110 / 5175 / 5199 / 5218 / 5219 / 5220 |

Cursor 终端对 8111 的日志捕获在 Developer 自验后中断，本轮 HTTP 证据改用：员工端 CDP 网络、`t025.db` 落库、以及 Tester 直连 `http://127.0.0.1:8111` 读取同一 `conversation_id`。

## 执行动作

1. `sdd_dispatch.py`：`gate_phase=passed`（T-035），`execution_mode=automatic`，T-025 已在途 `testing`。
2. 独立 Chrome CDP（端口 9531，headless）登录员工端，稳住 React 双发后的 `conversation_id` 再提问。
3. 脚本：`.sdd/test-reports/t025-tester/run-employee.mjs`
4. 证据：`.sdd/test-reports/t025-tester/evidence/`（截图 + `tester-browser-evidence.json` + `tester-db-dump.json`）

本轮会话（均 `status=bot`）：

- S1 `c7fd212f-f229-46d6-82c2-d93e3235b64c`：空态 / AC-001 / 013 / 016 / 012 / 014–015
- S2 `4a1d3756-599f-46ed-ad85-9b5803d78db2`：AC-021
- S3 `166d7c3b-0603-4998-9f38-59426e770739`：AC-019（直连 8111 GET 同源）

创建会话 POST 出现 6 次（3 个会话 × React 双发）；已钉住所用 `conversation_id` 后继续，提问 11 次全部 200。无 `/transfer`。

## 逐 AC

| AC | 结果 | 预期 | 实际 | 证据 |
| --- | --- | --- | --- | --- |
| 空态 / 无 Mock（TC） | PASS | 「描述你的购物问题」；页面无 `[Mock]` | 空态原文正确；顶栏「已登录：employee」；状态「AI 接待中」；无 Mock、无「IT 问题」空态 | `tester-empty.png` |
| AC-001 | **PASS** | 标签范围内知识回答，未等待客服 | 问星海 X1 续航/颜色 → 一条「知识问答」：48 小时、星海蓝；`kind=knowledge`；`status=bot`；转人工按钮仍可用 | `tester-ac001.png`；S1 第 1 轮 |
| AC-012 | **PASS** | 闲聊直接回复，不依赖知识分块 | 「闲聊」：天气/心情，未引用星海 X1 或云棉连衣裙；`kind=small_talk`，非兜底 | `tester-ac012.png` |
| AC-013 | **PASS** | 只问一类时不把另一类当依据 | 3C 答不含七天无理由；服饰答含 7 日/吊牌，不含只换不修/星海蓝/蓝牙 | `tester-ac001.png`、`tester-ac013.png` |
| AC-014 | **PASS** | 包裹位置/库存/支付/超范围固定兜底；不自动转人工、不建工单 | 四例均为兜底原文；`kind=fallback`；会话仍 bot；GET ticket **409**「会话尚未转人工，不能填单」；`tickets` 表 **0 行** | `tester-ac014-*.png`；CDP ticket 409 |
| AC-015 | **PASS** | 不编造实时物流/库存/支付 | 四例正文均为 config `fallback_reply`，无位置/件数/支付结果 | 同上 |
| AC-016 | **PASS** | 一次两问，同一条回复分段，不是多条系统消息 | 蓝牙 5.4 与退货 7 日写在**同一**「知识问答」气泡；DOM other +1、系统消息 +1 | `tester-ac016.png` |
| AC-019 | **PASS** | 只说「能不能退」且补全不出商品 → 反问；原问与改写入会话 | 「反问」要商品品类；非兜底、非知识猜测；`original=能不能退`，`rewritten=能不能退` 已落库 | `tester-ac019.png`；S3；8111 GET |
| AC-021 | **PASS** | 上文云棉连衣裙后只说「能退吗」按该商品退货处理 | 改写为「云棉连衣裙能退吗」；知识回答七天无理由/吊牌/华东服饰仓；非全新兜底 | `tester-ac021.png`；S2 |

固定兜底原文（与 `backend/.env` 的 `fallback_reply`、PRD 一致，报告只写字段名与是否一致）：

`抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。`

## 技术检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| AC-013 灌入 3C 与服饰后只问一类 | PASS | 两篇 `ready` + `user_visible`；回答口径未混用 |
| AC-016 一次发 3C 规格 + 服饰时限，同一次回复分段 | PASS | 单条 `knowledge`，两段分别答蓝牙与 7 日 |
| AC-014/015 四例兜底 = config；无工单/实时工具；bot 会话 tickets 无行 | PASS | 四例原文一致；百炼客户端 `chat_completions` 无 `tools`；无 `/transfer`；`t025.db` tickets=0；ticket GET 409 |
| 空态购物文案；前端无 `[Mock]`；真实 API 非 Mock | PASS | 截图；CDP `/api/sessions`、`/api/conversations/*/messages` 200；8111 可读同一会话 |

## 范围外

- T-045 正在改磁盘 `backend/src/services/retrieve.py`；本轮**没有**把该磁盘新哈希装进 8111。
- 物流异常轨迹（T-046）、已有工单进度（T-052）、工单填单不在本任务。
- MessageList 在「有会话但无可显示消息」支路仍写「描述你的 IT 问题」；本轮空会话走员工页主空态，未触发该支路，不计入本任务判定。

## 结论

当前任务指定 AC（001、012、013、014、015、016、019、021）及对应 technicalChecks 均已在真实员工端闭环验证通过。总结果 **PASS**。
