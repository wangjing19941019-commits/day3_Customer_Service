# T-035 Tester 报告

- 任务：T-035 前端：确认方案 Mock 收口与用户门禁
- 总结果：**PASS（前端阶段 / Mock）**
- 时间：2026-09-23
- 模式：automatic；`sdd_dispatch.py` `gate_phase=frontend_in_progress`，`gate_task_id=T-035`，`step_phase=not_applicable`，`tester_ready` 含 T-035
- `acceptanceCriteria=[]`。本 PASS 只表示前端 Mock 阶段通过，不计业务 AC。业务 AC 由 **T-025～T-027、T-045～T-052** 关 Mock 真实验收
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git、`user_gate`（仍为 `pending`）
- Tester PASS ≠ 用户放行。需交用户验收 Mock 与填写后端 API 配置

## 环境

| 项 | 值 |
| --- | --- |
| 预览 | http://127.0.0.1:5199/ |
| Mock | `$env:VITE_USE_MOCK='true'`；页内 `isMockEnabled()=true` |
| 账号 | employee / agent / admin（口令不入报告） |
| 视口 | 1440×900；窄屏 900×800 |
| 浏览器 | 独立 headless Chrome 153.0.8010.48 / CDP **9495**，临时 user-data |
| 静态 | `npm run type-check` 退出码 0；`npx eslint` `mocks/index.ts` + `mockAdapter.ts` 退出码 0；`npm run build` 退出码 0 |
| 百炼配置 | `.env.example` 含字段名；本地 `.env` 中 `llm_api_key` / `llm_base_url` / `llm_model` / `embedding_model` 等为非空。未读、未写入密钥 |

未占用/未结束 5175、8099。Tester 自起 5199 仍在，供门禁预览。Chrome/CDP 已关。

指纹（SHA256 前 16 位）：

- `mockAdapter.ts` `54FC67A79FF240F3`
- `mocks/index.ts` `617F10C7C6AF33A1`
- `mocks/tickets.ts` `C07374E24E576923`（与 T-031 相同）
- `mocks/ticketList.ts` `FEDDFE4443C5AD0E`（与 T-033 相同）
- `mocks/documents.ts` `0BCB36A36413E6CE`（与 T-030 相同）
- `AgentInboxPage.tsx` `80683BFB6A0947FF`（与 T-031 相同）

## 检查表

`acceptanceCriteria=[]`。下列为三条 `technicalChecks` 拆出的场景。全部为 Mock。

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | employee 登录 | 打开 `/login`，填 `employee`，点登录 | 进员工端 | Chrome 点击 + `t035-employee.png` | `pathname=/employee`；顶栏「已登录：[Mock] employee」；侧栏仅「员工端」；空态「描述你的购物问题」 | PASS（Mock） |
| TC-01b | agent 登录 | 退出后用 `agent` 登录 | 进客服端，无模板入口 | 点击 + `t035-agent-no-type.png` | `pathname=/agent`；侧栏仅「客服端」 | PASS（Mock） |
| TC-01c | 坐席打不开模板 | agent 直开 `/templates` | 不能留在模板页 | `Page.navigate` + `t035-agent-blocked.png` | 回到 `/agent`；无 `.tpl-editor` | PASS（Mock） |
| TC-01d | 未选六类不能确认 | 打开已转接会话，类型空 | 「确认工单」禁用 | DOM | `typeValue=""`，`confirmDisabled=true`；六类选项齐全 | PASS（Mock） |
| TC-01e | 订单多条不预选 | 转人工后发「昨天有两笔蓝色手机要退」，选退换货+3C | 只列候选、不预选；待确认 | 点击 + `t035-order-candidates.png` | 订单号空、状态「待确认」`rgb(180,83,9)`；两条候选 JD20260922001 / JD20260922002，`aria-pressed=false` | PASS（Mock） |
| TC-01f | 润色不合规不能采用 | 输入「一定全额退，赔500元」点润色 | 无「采用」；Danger 合规风险 | 点击 + `t035-polish-risk.png` | 无采用按钮；红字「合规未通过，不能直接采用润色稿」`rgb(180,35,24)` | PASS（Mock） |
| TC-01g | 知识推送不进员工对话 | 坐席有 3C 推送后回员工端 | 员工线程无坐席推送原文 | 点击 + `t035-employee-after-push.png` | 员工仅反问/原问；无「以签收后的保修说明为准」；无「发给用户」 | PASS（Mock） |
| TC-01h | admin 知识可见范围 | `admin` 登录 → 点已完成文档 | 用户可见 / 仅坐席可见 / 高风险仅人工；生效时间；次按钮保存 | 点击 + DOM；`t035-visibility.png` | 三项中文单选；起止时间控件；「保存可见范围和生效时间」为 `btn-secondary`；无枚举名泄漏 | PASS（Mock） |
| TC-01i | `/tickets` 空搜 | 工单号 `NO-SUCH` 点筛选 | 「当前没有符合条件的工单」 | 点击 + `t035-tickets-empty.png` | 空态该句；0 行 | PASS（Mock） |
| TC-01j | 无评测集不能灰度 | admin 打开 `/templates` | 灰度禁用并写明不足 5000 | 点击 + `t035-templates.png` | 「灰度约 5%」disabled、次按钮；文案含「没有不少于 5000 条的评测集，不能开始灰度」 | PASS（Mock） |
| TC-01k | 冲突保留原值 | 本轮抽测订单候选；冲突路径 | 金额仍 99 并标冲突 | 复用 T-031（`tickets.ts` 指纹未变）+ `t031-amount-conflict.png` | T-031：值 99、状态「冲突」、文案含 88 | PASS（复用，Mock） |
| TC-02a | 1440 客服布局 | 视口 1440×900 | 左 320 / 右 360；输入钉底；确认与发送不并排同级主按钮 | 几何 + 截图 | 列表 320px、工作台 360px、`flex=row`、`pinGap=0`、`sameRowPrimary=false` | PASS（Mock） |
| TC-02b | 窄于 1024 | 视口 900×800 | UI-03：列表约 40vh，工作台在对话下方 | `t035-narrow.png` | `flex=column`；`listHeightRatio=0.4`；`workBelowThread=true`（workTop=threadBottom=744） | PASS（Mock） |
| TC-02c | 管理端表格溢出 | admin `/tickets` 1440 | 无整页横向溢出 | DOM | `body.scrollWidth=1440=innerWidth`；表头六列齐全 | PASS（Mock） |
| TC-02d | `[Mock]` 与信封 | 全页可见数据；handler 信封 | 带 `[Mock]`；信封对齐 §二 | 页面 + `import('/src/mocks/conversationStore.ts')` | 顶栏/列表/工单/模板均 `[Mock]`；成功/失败信封含 `success/data/error/error_code/message/timestamp/request_id/metadata`，无多余键 | PASS（Mock） |
| TC-03 | 范围 | 契约 | 本 PASS 不计业务 AC | 任务/联调责任 | 未关 Mock，未打真实 API | 不计入；后续任务 |

38 项浏览器断言 `failed: []`。

## 复用前序稳定证据（本轮未重跑全量）

T-001～T-005、T-015、T-017、T-019～T-021、T-029～T-034 均为 PASS（Mock）。本轮只补跨页收口与上表抽测。冲突路径因 `tickets.ts` 指纹与 T-031 相同，复用该任务证据。

## 实际结果（脱敏）

1. `employee` → `/employee`；`agent` → `/agent` 且无模板导航，直开 `/templates` 被送回客服端；`admin` → `/knowledge`，侧栏「知识库 / 工单列表 / 模板」。
2. 未选工单类型时确认禁用。转人工后两笔蓝色手机：订单号待确认、两条候选均未按下。
3. 润色「一定全额退，赔500元」不能采用，仅红字合规风险。坐席知识卡片可见，员工对话没有该推送。
4. 已完成文档可设三种可见范围与生效时间，保存为次按钮。工单号 `NO-SUCH` 空态正确。评测 0 条时灰度禁用。
5. 1440 客服左 320 / 右 360，输入钉底。900 宽下列表 40vh、工作台在对话下方。工单表无整页溢出。

## 证据位置

- `.sdd/test-reports/test-T-035.md`（本文件）
- `.sdd/test-reports/t035-browser-evidence.json`（`pass: true`，`failed: []`）
- `.sdd/test-reports/t035-browser.mjs`
- 截图：`t035-employee.png`、`t035-agent-no-type.png`、`t035-order-candidates.png`、`t035-polish-risk.png`、`t035-narrow.png`、`t035-employee-after-push.png`、`t035-admin-knowledge.png`、`t035-visibility.png`、`t035-tickets.png`、`t035-tickets-empty.png`、`t035-templates.png`、`t035-agent-blocked.png`

## 观察（不计入失败）

- Mock 开启时页面 service 仍直连 handler，不经过 axios。页面行为正常，按派发说明不因此失败。`mockAdapter` 仍覆盖 API-001～035，信封未偏离 §二。
- 转人工前反问气泡含「连衣裙」示例后，抽取把商品信息写成「连衣裙」，与后发的两笔蓝色手机并存。订单候选仍正确。不扩大为本任务失败。
- 工单空态句本身无 `[Mock]` 前缀（与 T-033 一致）；页标题与顶栏有 `[Mock]`。
- `vite build` 提示 `conversations.ts` 动态导入无效分割，与本任务无关。
- 可见范围编辑区在详情下方，1440 整页截图未滚到该区块；DOM 已核到三项与次按钮。

## 未验 / 责任外

- 业务 AC：T-025（REQ-001）、T-026（REQ-005）、T-027（REQ-006/007）、T-045（可见范围真实召回）、T-046/T-047、T-048（十角色/403）、T-049（模板灰度真实）、T-050（工单队列）、T-051、T-052（进度回写）。不得用本 Mock PASS 代替。
- 真实联调、关闭 Mock、用户门禁端口 5175：本轮未做。
- `user_gate` 仍为 `pending`。编排器在 Tester PASS 后置 `awaiting_user`，不由 Tester 改成 `passed`。

## 门禁提示（交编排器）

需交用户验收 Mock 与填写后端 API 配置。Tester PASS ≠ 用户已放行。

可复用预览（Mock）：

```
cd frontend
$env:VITE_USE_MOCK='true'
npx vite --host 127.0.0.1 --port 5199 --strictPort
```

当前已在 `http://127.0.0.1:5199/`。三种身份：`employee`、`agent`、`admin`。避开 5175 / 8099。

## 经验候选

无。
