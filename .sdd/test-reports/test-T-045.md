# T-045 Tester 报告

- 任务：T-045 联调：知识可见范围、生效时间与用户侧过滤
- 类型：integration；`source_feature=F-002`（REQ-002）
- 本轮范围：只验收 **AC-053、AC-059、AC-060**
- 总结果：**FAIL**
- 时间：2026-09-23
- Tester 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git 写操作；未写入口令、Token 或密钥；未写 `experience.md`

> 2026-09-23 修复复验见文末「复验（修复轮）」；以下原文 **FAIL** 保留不改。

调度：`execution_mode=automatic`；`sdd_dispatch.py` 输出 `gate_phase=passed`（T-035）、`step_phase=not_applicable`、`tester_ready` 含 T-045。依赖 T-035 / T-030 / T-037 均为 passed。Developer `db0e362e-8d84-47b7-a661-17c628de173a` 自验仅作环境交接，本轮独立点击。不得用 Mock 通过。

## 环境与版本

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5220/ ；进程 `vite --host 127.0.0.1 --port 5220 --strictPort`；页内 `isMockEnabled()=false` |
| 后端 | http://127.0.0.1:8110/ ；`.sdd/tmp-t045/t045_serve.py`；`database_path=data/t045.db` |
| 隔离库 | `backend/data/t045.db` 验收前 360448 字节，验收后 364544 字节（会话/工单写入） |
| 业务库 | `backend/data/Customer_Service.db` 622592 字节，mtime `2026-09-17 22:38:41`，验收前后一致，未读写 |
| Mock | 登录/知识库/员工/坐席页 `pageHasMock=false`；无 `[Mock]` 徽章 |
| 账号 | `admin` / `employee` / `agent`；口令来自 `backend/.env` 的 `shared_password`，报告不写值 |
| 百炼 | `llm_api_key` 状态为 present；AC-059/060 智能回答已实测，未记未验 |
| 浏览器 | 独立 headless Chrome，CDP **9561**（主验）/ **9563**（AC-060 定向复核），临时 user-data，视口 1440×900 |
| 解释器 | 项目 `.venv` Python；Node 运行 Tester 脚本 |
| 仓库指纹 | harness 根 `git rev-parse --short HEAD` = `ec75f8f` |
| 前端指纹（SHA256 前 16 位） | `mockFlag.ts` `ED50E99695B16BAD`；`KnowledgePage.tsx` `56F02A4E8E4F4A3C`；`DocumentVisibilityEditor.tsx` `A87FF4DBC272A52D`；`KnowledgePanel.tsx` `FD590F675BD39D5A` |

未启动、未停止 8099 / 8108 / 8109 / 5218 / 5219 / 5175 / 5199。Tester Chrome/CDP 已关闭。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| AC-053-a | 已完成 `t045-user-visible.md` | 填独立时间 2026-06-18 08:45～2026-12-11 17:20，点「保存可见范围和生效时间」 | 当前详情显示这两个时间；无 `[Mock]` | Chrome 点击 + PATCH `/api/documents/{id}` 200 | 输入框即为上述两个值；`mockEnabled=false` | PASS |
| AC-053-b | 刚保存的文档 | 点开高风险篇（等分块），再点回用户可见篇（等分块） | 仍是这两个时间 | Chrome 离开再打开 | `from=2026-06-18T08:45`，`to=2026-12-11T17:20`，1 块 | PASS |
| AC-053-c | 已填时间的文档 | 清空起止时间并保存；点开仅坐席篇（等分块），再打开用户可见篇 | 两个时间为空 | Chrome 清空、离开、再打开 | `from=""`，`to=""` | PASS |
| AC-059-a | 仅坐席文档 | 管理端二次点开，等分块预览 | 可见范围为仅坐席，分块含内部步骤 | Chrome 等 `.kb-chunk` | `visibility=agent_only`，2 块，含内部步骤标记 | PASS |
| AC-059-b | 未转人工员工 | 问「冻结仓内批次码 / 质检豁免」 | 不能用仅坐席文档回答 | Chrome 发送 | 兜底，正文无内部步骤 | PASS |
| AC-059-c | 未转人工员工 | 问「未拆封手机七天无理由」 | 答出对客话术，无内部步骤 | Chrome 发送 | FAQ：「未拆封的手机支持七天无理由退货…」；无内部步骤 | PASS |
| AC-059-d | 已转人工坐席 | 右栏按文档名/推送查看仅坐席篇 | 能看见全文内部步骤 | Chrome 客服端右栏 | 推送卡片含 `t045-agent-only.md` 与内部步骤 | PASS |
| AC-060-a | 高风险文档 | 管理端二次点开，等分块 | 可见范围为高风险仅人工，分块含完整口径 | Chrome 等 `.kb-chunk` | `visibility=high_risk_human_only`，1 块，含完整口径 | PASS（管理端） |
| AC-060-b | 未转人工员工 | 问「屏幕进液内部补偿」 | 自动回答不使用该文档 | Chrome 发送 | 兜底，无高风险口径 | PASS |
| AC-060-c | 已转人工坐席 | 右栏滚动或搜索，打开高风险全文 | 坐席能看到完整内容 | Chrome 搜索文件名；定向复核搜「屏幕进液高风险赔付」 | 右栏仍是用户可见+仅坐席两张卡片，无高风险篇 | **FAIL** |
| AC-060-d | 坐席已查看知识后 | 回到员工会话 | 高风险内容不会自动发给用户 | Chrome 员工页 + 右栏提示 | 员工消息无高风险口径；右栏有「仅坐席可见，不会发给用户。」 | PASS |
| TC-01 | 真实联调非 Mock | 各角色页面 | `VITE_USE_MOCK=false`；无 `[Mock]` | Chrome `isMockEnabled()` | 登录/知识库/员工/坐席均为 false | PASS |
| TC-02 | 报告与配置 | 全程 | 不把密钥写入报告 | 人工核对产出 | 证据只留字段名/状态；Token 已脱敏；未抄写口令 | PASS |

## 实际执行

1. 核对实例：5220 代理登录与文档列表与 8110 相同三篇 `t045-*.md`；`GET /docs` 200；`llm_api_key` present。
2. 独立接口：`.venv` 自 `backend/` 运行 `.sdd/test-reports/t045-ac/run-api.py`（读 `shared_password`，不打印值）。
3. 独立浏览器：Node 运行 `.sdd/test-reports/t045-ac/run-browser.mjs`（CDP 9561，不复用 Developer 的 9550/9551）。
4. AC-053 使用本轮独立时间，不沿用开发自验的 04-01/10-31。二次点开仅坐席/高风险均等到分块预览再读可见范围。
5. AC-060 坐席侧首次按文档名搜索未出现高风险卡片。按 Tester 规则做一次定向复核：直连 API 用正文检索可返回高风险篇；再开独立 Chrome（CDP 9563）搜索「屏幕进液高风险赔付」，等待 45s 并滚动右栏，页面仍是默认推送的另外两篇。

接口脱敏结果（8110 直连，除非注明代理）：

- `admin` / `employee` / `agent` 登录均为 200，角色分别为 `admin` / `employee` / `frontline_agent`
- 5220 代理登录 `admin` 200，列表 3 篇，与 8110 一致
- 坐席 `GET .../knowledge-suggestions`：无 `q` → 2 条（用户可见 + 仅坐席）；`q=t045-high-risk.md` → 0 条、空文案「当前没有可推送的政策或流程」；`q=屏幕进液` / `q=屏幕进液高风险赔付` → 1 条，`visibility=high_risk_human_only`，含完整口径

浏览器网络：知识库保存走真实 `PATCH /api/documents/{id}` 200；员工提问走真实 `POST /api/conversations/{id}/messages`；坐席推送走真实 `GET .../knowledge-suggestions`。

## AC

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-053 | **PASS** | 已完成文档填独立起止时间并保存；离开再打开仍是这两个时间；清空后保存再打开为空。真实 API，无 `[Mock]`。 |
| AC-059 | **PASS** | 仅坐席文档未进入未转人工回答（兜底）；用户可见问题 FAQ 答出对客话术且无内部步骤；转人工后坐席右栏能看到仅坐席全文。 |
| AC-060 | **FAIL** | 未转人工自动回答未使用高风险文档，员工侧也未自动收到该内容。管理端能打开完整分块。但**坐席端右栏推送/搜索未展示该篇完整内容**：自动推送只有另外两篇；按文件名搜索为空；按正文搜索在页面上仍停留在默认两张卡片。 |

## FAIL 复现与修复方向

**AC-060 坐席侧看不到高风险全文**

最短复现：

1. 用 `employee` 在 http://127.0.0.1:5220/ 提问「手机屏幕进液了，会按内部补偿方案赔付吗？」后转人工。
2. 用 `agent` 打开该会话，看右栏「知识推送」（需滚动）。
3. 搜索框输入 `t045-high-risk.md` 或 `屏幕进液高风险赔付` 并点搜索。
4. 右栏仍是用户可见退货说明与仅坐席内部手册，没有高风险赔付卡片。

相关位置：

- 客服端右栏：`frontend/src/components/agent/KnowledgePanel.tsx`
- 打开会话/改类型会无 `q` 重拉推送：`frontend/src/hooks/useTicket.ts`（`refreshKnowledge(conversationId)` 依赖 `lastMessageId` / `ticket_type` / `business_line`）
- 召回：`backend/src/services/agent_knowledge.py`、`backend/src/services/retrieve.py`（`AUDIENCE_AGENT` 允许 `high_risk_human_only`，但文件名检索融合分过低会空结果；自动推送 TopK 未纳入该篇）

修复方向：坐席搜索结果必须以当前 `q` 展示且不被工单刷新覆盖；自动推送或搜索应能按正文（以及用户可理解的文档名）命中高风险仅人工文档，并在右栏完整显示、仍不发给用户。

## 证据位置

绝对目录：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service\.sdd\test-reports\t045-ac\`

- `t045-api-evidence.json`
- `t045-browser-evidence.json`（CDP 9561）
- `t045-browser-retest-ac060.json`（CDP 9563，定向复核）
- `t045-login.png` / `t045-kb-saved.png` / `t045-kb-reopen.png` / `t045-kb-cleared.png` / `t045-kb-agent-only.png` / `t045-kb-high-risk.png` / `t045-employee.png` / `t045-agent.png` / `t045-agent-search.png` / `t045-agent-search-risk.png` / `t045-employee-after-agent.png` / `t045-agent-search-risk-retest.png`

Developer 自验目录 `.sdd/tmp-t045/` 未当作本轮判定依据。

## 未验项

- AC-048 过期政策不进当前依据（T-047）
- 其余不在本任务 `acceptanceCriteria` 的知识库 AC
- 坐席把高风险内容手动粘贴发送（本轮只验「不会自动发给用户」）

## 范围外

- 工单抽取把类型填成「售前咨询（不建单）」出现在定向复核截图中，不计入 AC-053/059；可能加剧坐席知识刷新，交编排器判断是否另开任务。

---

# 复验（修复轮）

- 任务：T-045；复验上次 **AC-060 FAIL**，抽查 **AC-053、AC-059**
- 总结果：**PASS**
- 时间：2026-09-23
- Developer 自验 `b9799d9b-b415-4613-9b27-ff8b57dd91f6` / `.sdd/tmp-t045/t045-ac060-retest.json` **不算通过**；本轮独立点击 http://127.0.0.1:5220/
- Tester 未改业务代码、`.sdd/tasks.json`；未 Git；未写 `experience.md`；报告不写口令或 Key
- 调度复核：`execution_mode=automatic`；`sdd_dispatch.py` `gate_phase=passed`（T-035）、`tester_ready` 含 T-045

## 复验环境

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5220/ ；`VITE_USE_MOCK=false`；启动时 `VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8110`；pid 40368，未重启 |
| 后端 | http://127.0.0.1:8110/ ；`.sdd/tmp-t045/t045_serve.py`；`database_path=data/t045.db`；进程约 10:27:49 启动（晚于召回改动 10:23），**未再重启** |
| 隔离库 | `backend/data/t045.db` 复验前 368640 字节，复验后 376832 字节（会话/工单写入） |
| 业务库 | `backend/data/Customer_Service.db` 622592 字节，mtime `2026-09-17 22:38:41`，始终未读写 |
| Mock | 登录/知识库/员工/坐席 `isMockEnabled()=false`；页内无 `[Mock]` |
| 账号 | `admin` / `employee` / `agent`；口令来自 `backend/.env` 的 `shared_password`，报告不写值 |
| 百炼 | `llm_api_key` 状态 present；员工自动回答已实测 |
| 浏览器 | 独立 headless Chrome，CDP **9580**，临时 user-data，视口 1440×900 |
| 仓库指纹 | `ec75f8f` |
| 文件指纹（SHA256 前 16 位） | `mockFlag.ts` `ED50E99695B16BAD`；`KnowledgePage.tsx` `56F02A4E8E4F4A3C`；`DocumentVisibilityEditor.tsx` `A87FF4DBC272A52D`；`KnowledgePanel.tsx` **`27E2008A182646C0`**（相对上次 FAIL 的 `FD590F675BD39D5A` 已变）；`useTicket.ts` `77B0FD7277A790EF`；`agent_knowledge.py` `1851F5B7679D3CD7`；`retrieve.py` `E575872D05B29CFA` |

未启动、未停止 8099 / 8108 / 8109 / 8111 / 5175 / 5199 / 5218 / 5219 / 5221。Tester Chrome/CDP 9580 已关闭。

5220 代理文档列表与 8110 相同三篇：`t045-user-visible.md` / `t045-high-risk.md` / `t045-agent-only.md`。

## 复验检查表

| ID | 场景 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| AC-053-a | 用户可见篇填独立时间 2026-07-03 09:15～2026-11-28 18:40 并保存 | 详情仍是这两个时间；无 `[Mock]` | 输入框即为上述值；`PATCH /api/documents/{id}` 200 | PASS |
| AC-053-b | 点开高风险篇再点回用户可见篇 | 仍是这两个时间 | `from=2026-07-03T09:15`，`to=2026-11-28T18:40`，1 块 | PASS |
| AC-053-c | 清空保存，离开仅坐席篇再打开 | 两个时间为空 | `from=""`，`to=""` | PASS |
| AC-059-b | 员工问冻结仓内批次码 / 质检豁免 | 不能用仅坐席文档回答 | 兜底；正文无内部步骤标记 | PASS |
| AC-059-c | 员工问未拆封七天无理由 | 答出对客话术，无内部步骤 | FAQ：「未拆封的手机支持七天无理由退货…」；无内部步骤 | PASS |
| AC-059-d | 转人工后坐席搜 `t045-agent-only.md` | 看见仅坐席全文 | 2 张 `agent_only` 卡片；正文含内部步骤；hold 10s 仍在 | PASS |
| AC-060-b | 员工问屏幕进液内部补偿 | 自动回答不用高风险口径 | 兜底，无高风险全文 | PASS |
| AC-060-c | 坐席搜 `t045-high-risk.md` | 右栏出现高风险全文，数秒后不被默认两卡盖掉 | 1 张 `high_risk_human_only`；全文含屏幕进液内部口径；hold **10s** 仍 1 张 | **PASS（原 FAIL 已修复）** |
| AC-060-c2 | 坐席搜「屏幕进液高风险赔付」 | 同上 | 搜索框为该正文；仍 1 张高风险全文；hold 10s 仍在 | PASS |
| AC-060-d | 坐席查看后回到员工会话 | 高风险不会自动发给用户 | 员工消息仍是兜底；右栏「仅坐席可见，不会发给用户。」；坐席未点发送 | PASS |
| TC-01 | 各角色页面 | 无 `[Mock]` | 登录/知识库/员工/坐席均为 false | PASS |

脚本里 `ac059-agent-search-internal` / `ac060-agent-search-filename` / `ac060-agent-search-body` 曾记 FAIL：`hasRiskToken` 误读了页面**第一个** `.work-block`（工单栏）。同一疑点做了一次定向复核：`.knowledge-card` 的 `data-filename` / `data-visibility`、`emptyHint` 卡片正文和截图均命中全文。**按卡片与截图改判 PASS**，不把脚本布尔当产品缺陷。

## 上次 FAIL 对照

原问题：坐席右栏搜高风险文档后仍停在默认两张卡片；按文件名搜索接口为空。

本轮：

1. `GET .../knowledge-suggestions?q=t045-high-risk.md` **200**，页面 1 张高风险卡片，不是默认两张。
2. `q=屏幕进液高风险赔付` 同样 1 张高风险全文。
3. 搜索后等待 10s（覆盖工单抽取约 3s 轮询），卡片未退回用户可见 + 仅坐席两张。

未沿用开发自验 JSON 的 pass 字段。

## 经验候选核对（交编排器落盘，Tester 未写 experience.md）

项目 `.sdd/experience.md` 无「坐席搜索被刷新覆盖 / 文件名召回」旧条目。

| 候选 | 证据 | 判定 |
| --- | --- | --- |
| 坐席搜索后工单刷新若无 `q` 重拉，会把结果盖成默认推送；需保留当前搜索词 | 搜文件名/正文后 hold 10s 仍是高风险 1 张，未被默认两卡替换 | **用户结果已验证**；未单独关掉前端或后端改动做 A/B |
| 按文件名搜索要把 filename 纳入匹配，否则接口空 | `q=t045-high-risk.md` 200 且右栏出现该篇 | **用户结果已验证** |
| 根因拆成「只前端」或「只召回」 | 两处代码都已改（`KnowledgePanel`/`useTicket` 指纹变；8110 在 `retrieve.py` 改后重启） | **推测，未隔离**；功能 PASS 不自动证明单一根因 |

建议编排器：可沉淀「坐席知识搜索必须带着当前 q 刷新」和「文件名检索要能命中 filename」两条，适用本项目坐席知识推送；不要写成跨项目普遍规则。

## 复验证据

绝对目录：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service\.sdd\test-reports\t045-ac\`

- `t045-retest2-api.json`
- `t045-retest2-browser.json`（CDP 9580；以 `correctedChecks`、卡片字段和截图为准）
- `retest2-login.png` / `retest2-kb-saved.png` / `retest2-kb-reopen.png` / `retest2-kb-cleared.png` / `retest2-kb-agent-only.png` / `retest2-kb-high-risk.png` / `retest2-employee.png` / `retest2-agent.png` / `retest2-agent-search.png` / `retest2-agent-search-risk-file.png` / `retest2-agent-search-risk-file-hold.png` / `retest2-agent-search-risk-body.png` / `retest2-agent-search-risk-body-hold.png` / `retest2-employee-after-agent.png`

## 复验未验项 / 范围外

- AC-048 仍归 T-047
- 坐席手动粘贴高风险内容发送：本轮只验不会自动发给用户
- 工单类型仍出现「售前咨询（不建单）」，与上次范围外相同，不计入本任务 AC
