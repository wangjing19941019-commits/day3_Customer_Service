# T-029 Tester 报告

- 时间：2026-09-23
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`713e9943-c50d-4042-a0dc-ef620af2487c`
- Tester：本轮编排器派发的 Tester
- 模式：automatic；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`，`gate_task_id=T-035`，`T-029` 在 `in_flight_or_queued`（本轮收尾已在运行的验收）
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks` 的 Mock 行为。关联 AC-009 角色分流与 AC-061 的 Mock 由本任务覆盖；业务 AC 由联调 **T-048** 关 Mock 真实验收。本 PASS 不计业务 AC，不代替 T-035 门禁，不等于用户已放行。
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git。

## 环境

- 工作目录：`frontend/`；Tester 自起 `http://127.0.0.1:5211/`（`$env:VITE_USE_MOCK='true'; npx vite --host 127.0.0.1 --port 5211 --strictPort`，HTTP 200，VITE v8.3.0）。未占用/未关闭 5175、8099、5288、5216、5291。
- Mock：浏览器 JS（`VITE_USE_MOCK=true`）；未把真实 `/api` 当证据。未调用付费 LLM。
- 实测身份用户名：`employee`、`agent`、`admin`；旧账号 `it-help`；错误口令一次。报告不写口令。
- 视口：1440×900；无头 Chrome 153.0.8010.48 + CDP **9479**；独立 `user-data-dir` `t029-chrome-*`，不与其他智能体会话共用
- 指纹（SHA256 前 16 位）：
  - `LoginPage.tsx` `D4D487A663BC3F2D`
  - `TicketListPage.tsx` `DF22A648F640B648`
  - `TemplateAdminPage.tsx` `1186315A191BFBD2`
  - `AppShell.tsx` `4E164884EF4E9A04`
  - `router/index.tsx` `AC3D5F4AB8542D70`
  - `roleNav.ts` `67F5020E5109696A`
  - `mocks/auth.ts` `A886E82A882A2FA7`
  - `types/auth.ts` `59A0CF52656D7B94`
  - `authService.ts` `3EA9E233EDC1F495`
  - `AuthProvider.tsx` `54C7F9072D143870`
- 质量：`npx eslint` 针对本任务 ts/tsx 退出码 0；`npm run type-check` 退出码 0
- 证据：`.sdd/test-reports/t029-browser-evidence.json`、脚本 `t029-browser.mjs`、截图 `t029-*.png`
- 验收后已关掉本轮 Chrome/CDP 与 Tester 自起的 5211；未动其他已占用端口

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | employee 正确登录 | 打开 `/login` → 填 `employee` → 点登录 | 进 `/employee`；顶栏用户名带 `[Mock]` | Chrome 真实点击 + `t029-employee.png` | `pathname=/employee`；顶栏「已登录：[Mock] employee」；侧栏仅「员工端」 | PASS（Mock） |
| TC-01b | 一线坐席正确登录 | 退出后用 `agent` 登录 | 进 `/agent`；侧栏无模板/灰度 | 点击 + `t029-agent.png` | `pathname=/agent`；侧栏仅「客服端」；`navHasTemplate=false`、`navHasGray=false` | PASS（Mock） |
| TC-01c | admin 正确登录 | 退出后用 `admin` 登录，再点侧栏工单列表、模板 | 进知识库；能看到工单列表与模板占位 | 点击 + `t029-admin-knowledge.png`、`t029-admin-tickets.png`、`t029-admin-templates.png` | 先到 `/knowledge`；侧栏「知识库 / 工单列表 / 模板」；`/tickets` 标题 `[Mock] 工单列表`；`/templates` 标题 `[Mock] 模板配置` | PASS（Mock） |
| TC-01d | 错误密码 | `employee` + 错误口令 → 点登录 | 仍留登录页；失败说明带 `[Mock]` | 点击 + `t029-wrong-password.png` | `pathname=/login`；alert「[Mock] 用户名或密码错误」；用户名仍为 employee；无 token | PASS（Mock） |
| TC-02a | 顶栏外壳 | 三种身份登录后看顶栏 | 「已登录：用户名」+「退出」；对照 UI-01 登录卡与 56px 顶栏 | 计算样式 + 截图 | 登录卡居中 `centerDelta=0`、标题 20px/600、主色 `rgb(29, 78, 137)`、主按钮 40px；登录后顶栏 56px，均有用户名与退出 | PASS（Mock） |
| TC-02b | 身份不对的路由 | employee 打开 `/agent`、`/knowledge`；agent 打开 `/templates`、`/tickets`；admin 打开 `/employee` | 不能使用该页能力，回到本身份首页 | `location.assign` 后读 pathname | employee 仍 `/employee`；agent 仍 `/agent` 且无模板导航；admin 被送回 `/knowledge` | PASS（Mock） |
| TC-02c | 占位页可编译 | admin 打开 `/tickets`、`/templates` | 页面可打开，带 `[Mock]` | 点击 + 截图 | 两页均可渲染占位文案，无白屏 | PASS（Mock） |
| TC-02d | type-check / lint | 按改动跑 | 通过 | 命令 | eslint 本任务 ts/tsx 退出码 0；`npm run type-check` 退出码 0 | PASS |
| TC-03 | 本 PASS 不计业务 AC | 契约核对 | 真实登录归 T-048 | 任务/联调责任 | 未关 Mock，未打真实 API-001/002 | 不计入；T-048 |
| 附加 | 旧账号 `it-help` | 登录一次 | 仍是 employee | 点击 + `t029-it-help.png` | `/employee`；顶栏「已登录：[Mock] it-help」 | 通过（补充，非独立 AC） |

## 未验 / 责任外

- 业务 AC-009 / AC-061：关闭 Mock 后由 **T-048** 真实验收（十角色种子与 403）。AC-009 的旧共享账号真实路径此前由 T-010 承接。
- 其余队列身份（`specialist`、`senior`、`supervisor`、`after_sales_supervisor`、`cs_lead`、`logistics_agent`、`cs_supervisor`）未逐个点登录；登录页十个用户名均可见。本轮按 technicalChecks 与派发说明验三种身份。
- 用户门禁：唯一 `user_gate` 在 **T-035**。本 PASS 不放行门禁。
- 真实 API-001/002、关 Mock、5175 用户验收端口：本轮未启。

## 观察（不计入失败）

- 登录卡说明仍展示演示账号与口令（与 UI-01 / 原型 01-login 示例一致）。本报告不复述口令。
- UI-01 失败文案写「用户名或密码不正确」，页面按 API-001 显示「用户名或密码错误」。语义与 T-001 既有行为一致。
- 界面 Mock 数据带 `[Mock]`。JWT 仍用 `localStorage` 键 `access_token`。

## 门禁提示（交编排器）

本任务不是 T-035。Tester PASS ≠ 用户已放行。不要开始 T-048。

可复用预览（Mock）：

```
cd frontend
$env:VITE_USE_MOCK='true'
npx vite --host 127.0.0.1 --port 5211 --strictPort
```

三种身份用户名：`employee`、`agent`、`admin`。避开 5175 / 8099 / 5288 / 5216 / 5291。

## 经验候选

无。
