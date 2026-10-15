# T-020 Tester 报告

- 时间：2026-09-22
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`daec6fd7-716a-46ea-810c-01923254966c`
- Tester 实例：本轮编排器派发的 Tester
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-021；本轮是已在途的 T-020 收尾验收
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks`。关联 AC-030～043 的 Mock 可观察行为由本任务 TC 覆盖；业务 AC 由联调 **T-026 / T-027** 真实验收。不代替 T-021 用户门禁。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`（本项目 Vite）
- 指纹：Harness HEAD `ec75f8f`；Customer_Service git 尚无 commit。验收时文件 SHA256 前缀：
  - `AgentInboxPage.tsx` `CF7EFD3AA918`
  - `useTicket.ts` `2A819F03FA68`
  - `tickets.ts` `5C02177D99BB`
  - `TicketWorkbench.tsx` `D1C0F965530E`
  - `KnowledgePanel.tsx` `DA64A5BC35FF`
- Mock：本进程 `VITE_USE_MOCK=true`（覆盖项目 `.env` 中的 `false`）；页面可见 `[Mock]`
- Tester 自起 Vite：`http://127.0.0.1:5204/`，`vite --host 127.0.0.1 --port 5204 --strictPort`，HTTP 200。未占用/未关闭 5199、8099、5201、5202、5203
- 浏览器：无头 Chrome 153 + CDP **9451**，视口 1440×900，独立 `user-data-dir` `t020-chrome-*`；验收后已关掉本轮 Chrome
- 账号：演示用户名 `it-help`（报告不写密码）
- 定向质量：`npm run type-check` 退出码 0；`npx eslint` T-020 路径退出码 0（css 文件无 eslint 配置，仅 warning ignored）
- 证据：`.sdd/test-reports/t020-browser-evidence.json`、`t020-agent-empty.png`、`t020-draft.png`、`t020-extracting.png`、`t020-digital-3c.png`、`t020-apparel.png`、`t020-invoice.png`、`t020-handedit.png`、`t020-complaint.png`、`t020-polish.png`、`t020-confirmed.png`、`t020-employee-after-send.png`；脚本 `t020-browser.mjs`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 转人工前打开 `/agent` | 登录后先到客服端 | 列表无未转接会话；无填单区 | CDP + `t020-agent-empty.png` | 列表 0 条；空态「还没有需要人工处理的对话」；无「确认工单」 | PASS（Mock） |
| TC-01b | 已转接草稿 | 员工发「这件连衣裙能退吗」并转人工，打开 `/agent` | 可选手选业务线；未选四类时确认禁用；带 `[Mock]`；对照 UI-03 左 320 / 右 360 | CDP + `t020-draft.png` | 确认禁用；类型/业务线为空；`[Mock]`；列表 320px、工作台 360px；顶栏「已登录：[Mock] it-help」 | PASS（Mock） |
| TC-01c | 只选退换货 | 选 `return_exchange`，业务线仍空 | 出现售后方式/原因/数量，无税号；确认仍禁用；抽取横幅 | CDP + `t020-extracting.png` | 横幅「[Mock] 正在根据对话补全…」；有 `return_method`/`quantity`，无 `tax_id`；确认仍禁用；输入区未锁 | PASS（Mock） |
| TC-01d | 补选业务线 | 抽取中改选 `digital_3c` | 类型+业务线齐全后可确认 | CDP | `confirmDisabled=false`；抽取中仍能改业务线 | PASS（Mock） |
| TC-01e | 退换货 vs 发票 | 切 `invoice` 再切回 `return_exchange` | 发票有抬头/税号且不要求数量；退换货有售后方式/数量且无税号（AC-041 Mock） | CDP + `t020-invoice.png` | 发票字段含 `invoice_title`/`tax_id`，无 quantity；切回后有售后方式/数量，无税号 | PASS（Mock） |
| TC-02a | 未转人工 409 | 转接前对当前会话调 Mock `handleGetTicket` | 409 CONFLICT「尚未转人工」 | 同页 `import('/src/mocks/tickets.ts')` | `status=409`，`error_code=CONFLICT`，文案「会话尚未转人工，不能填单」 | PASS（Mock） |
| TC-02b | 抽取预填 | 选类型后等横幅消失 | 数秒后预填；状态用「已提取」不是内部枚举 | CDP + `t020-digital-3c.png` | 商品「连衣裙」、状态「已提取」；横幅消失 | PASS（Mock） |
| TC-02c | 手改不被覆盖 | 改商品为「坐席手改-勿覆盖」，再切发票/退换货触发重抽 | `agent_edited` 保留 | CDP + `t020-handedit.png` | UI 与 `sessionStorage.mock_tickets` 均为 value=坐席手改-勿覆盖、status=`agent_edited` | PASS（Mock） |
| TC-02d | 未确认刷新 | 刷新 `/agent` | 仍为草稿；手改仍在 | CDP | 按钮仍是「确认工单」；类型可改；商品仍手改；store `status=draft` | PASS（Mock） |
| TC-02e | 确认后锁定 | 点确认工单，再改业务线/数量，并 PATCH 类型 | 已确认；类型不可改；字段与业务线可改；改类型 409 | CDP + `t020-confirmed.png` | 按钮「已确认」；类型 disabled=退换货；业务线改为 `digital_3c`；数量改为 2；PATCH 类型 409「工单已确认，不能更改工单类型」 | PASS（Mock） |
| TC-03a | 知识随业务线 | `digital_3c` 与 `apparel_beauty` 各点一次（退换货） | 3C 保修口径 vs 服饰七天无理由；互不串 | CDP + `t020-digital-3c.png` / `t020-apparel.png` | 3C：「以签收后的保修说明为准…不适用服饰七天无理由」；服饰：「签收后七日内可无理由退货…不适用于 3C 质保」 | PASS（Mock） |
| TC-03b | 未选业务线 / 投诉空态 | 草稿未选线；后选投诉 | 「未指定业务线，不套用单一口径」；投诉「当前没有可推送的政策或流程」；无「发给用户」按钮 | CDP + `t020-complaint.png` | 无业务线时两条 hint 都在；投诉 0 张卡片；无名为「发给用户」的按钮；有「仅坐席可见，不会发给用户。」 | PASS（Mock） |
| TC-03c | 知识不进员工对话 | 推送出现后打开员工端 | 员工消息没有坐席推送正文 | CDP | 员工侧只有 bot「服饰美妆支持七天无理由退货，需商品完好」与客服已发稿；没有「签收后七日内可无理由退货，吊牌完整」 | PASS（Mock） |
| TC-03d | 售前润色发送 | 未选四类时点润色再发送 | 确认仍禁用；润色只改输入区；发送走当前文本 | CDP | 润色后消息条数不变；发送后客服气泡为润色稿；确认仍禁用 | PASS（Mock） |
| TC-03e | 润色不编造全额退 / 发送当前稿 | 输入含「一定全额退」点润色；改回「改回原稿再发送测试」再发送 | 润色稿无全额退承诺；员工尚无润色条；员工看到发出的当前文本 | CDP + `t020-polish.png` / `t020-employee-after-send.png` | 润色稿改为「按现有规则核对处理方式」；员工消息数润色前后均为 3；发送后员工看到「[Mock] 改回原稿再发送测试」 | PASS（Mock） |
| TC-quality | type-check / lint | `npm run type-check`；eslint 改动路径 | 按改动通过 | 命令 | 两者退出码 0 | PASS |

## 未验 / 责任外

- 业务 AC-030～043：T-026（填单确认 / AC-041）与 T-027（知识推送、润色发出、未选类型）关闭 Mock 后真实验收。
- 窄屏工作台在对话下方：任务写明由 T-021 覆盖，本轮 1440 宽屏已量左 320 / 右 360，未做 <1024。
- 用户门禁预览端口 5175：T-021。本 PASS 不等于用户已放行。
- 真实 OMS / 销售单 / 润色自动发出：本任务明确不实现。

## 观察（不计入失败）

- 知识区文案含「不会发给用户」，不是「发给用户」按钮；按按钮判定。
- 首次脚本用 `element.blur()` 后立刻切类型，手改还在 React dirty 态、未写入 Mock store，刷新后被重抽成「连衣裙」。定向复核改为点到其他字段提交后再切类型/刷新：store 为 `agent_edited`，刷新后仍保留。判定为测试提交时序，不是 D-006 实现缺陷。
- `polishService` Mock 路径不走 HTTP；真实联调超时与方案 API-017 60000ms 是否一致由 T-027 核对。
- 组件从 `mocks/tickets.ts` 引用枚举与标签，Mock 阶段数据集中在 `frontend/src/mocks/`。

## 经验候选

无（首次手改刷新丢失已证实为测试未提交，不沉淀为产品缺陷经验）。
