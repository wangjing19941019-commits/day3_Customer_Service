# T-010 Tester 报告

- 时间：2026-09-17
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`fef747ba-8267-4b38-96af-49606a121f2e`
- Tester 实例：本轮联调验收
- 模式：automatic；`gate_phase=passed`（T-017）；`tester_ready` 含 T-010。`--running-task T-009`。Tester **未改** `tasks.json` / 业务代码 / PRD / tech-spec。
- 总结果：**PASS**
- 范围：`type=integration`。真实关 Mock 页面路径验收 AC-009、AC-010、AC-025、AC-026。不测入库/提问（T-011 / T-012）。未调用百炼。未把 Developer curl 当页面 AC 通过。

## 环境

- 工作目录：`frontend/`；`VITE_USE_MOCK=false`（`frontend/.env`）。页面 `import('/src/utils/mockFlag.ts')` → `isMockEnabled()===false`
- 指纹：Harness HEAD `ec75f8f`
- 服务：复用 Vite `http://127.0.0.1:5199/`（HTTP 200）与后端 `http://127.0.0.1:8099`（`/docs` HTTP 200）。Tester **未关闭、未重启** 5199 / 8099，未改 `backend/tests`
- 账号：演示用户名 `it-help`（报告不写密码）
- 视口：1440×900；无头 Chrome + CDP **9368**（独立 `user-data-dir` `t010-chrome-*`，未占用 T-017 的 9357 / `t017-chrome-*`）
- 证据：`.sdd/test-reports/t010-browser-evidence.json`、脚本 `t010-browser.mjs`、截图 `t010-*.png`
- 验收后：已关掉本轮 CDP Chrome；5199 / 8099 仍在（他方进程）
- `failed=[]`（19 项检查，含环境与技术项）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| AC-010 | 错密码 | 登录页填用户名、错误密码，点登录 | 不能进业务；可见 401 失败说明 | Chrome CDP 点击 + 截图 `t010-wrong-password.png` + Network | 仍在 `/login`；`role=alert` 文案「用户名或密码错误」；无 `access_token`；无业务外壳。`POST /api/sessions` HTTP 401 | PASS |
| AC-009 | 正确账号登录 | 再点登录；侧栏进员工端 / 客服端 / 知识库 | 能进入三页并使用对应页面能力；三页顶栏用户名一致 | CDP 点击 + `t010-employee.png` / `t010-agent.png` / `t010-knowledge.png` | 进入 `/employee`（AI 接待中、输入区可用）、`/agent`（客服收件箱空态）、`/knowledge`（上传与列表）。三页顶栏均为「已登录：it-help」。未发消息、未上传 | PASS |
| AC-025 | 已登录顶栏 | 三页各看一次顶栏 | 「已登录」+ 用户名 +「退出」 | 同上截图 | 三页均为「已登录：it-help」+ 次按钮「退出」。无 `[Mock]` | PASS |
| AC-026 | 退出后再直开业务地址 | 知识库点退出；再打开 `/employee` `/agent` `/knowledge` | 回登录页（当前未登录）；直开被要求登录 | CDP 点击 + `t010-logout.png`、`t010-direct-*.png` | 退出后 `/login`、「当前未登录」、token 已清。三地址均回到登录卡，无业务外壳 | PASS |
| TC-01 | 真实后端 401 / token / API-002 | 错密码与正确登录后读 token 并请求 API-002 | 401 文案可见；`localStorage.access_token` 存在；API-002 `username` 与顶栏一致 | Network + 页内 `fetch('/api/sessions/current')`（报告不写 token） | 401 文案可见；登录后 token 存在；API-002 HTTP 200 `username=it-help`，与顶栏一致 | PASS |
| TC-02 | 退出与 Mock 标识 | 点退出；全路径扫 `[Mock]` | 只清前端 token、无登出 API；直开回登录；页面无 `[Mock]` | CDP + `DELETE /api/sessions`、`POST /api/logout` | DELETE 405、logout 404。退出后 token 不存在。登录/三业务页均无 `[Mock]` | PASS |
| TC-03 | 端口与 CORS | OPTIONS 带 Origin 打 8099 | 5199 / 5175 的 localhost 与 127.0.0.1 均允许 | fetch OPTIONS | 四个 Origin 的 `Access-Control-Allow-Origin` 均回显对应来源。本轮使用 5199/8099 | PASS |

## 逐 AC

| AC | 结果 | 实际 | 证据 |
| --- | --- | --- | --- |
| AC-009 | PASS | 正确登录后进入员工端、客服端、知识库；三页顶栏用户名均为 `it-help` | `t010-employee.png`、`t010-agent.png`、`t010-knowledge.png`、`t010-browser-evidence.json` |
| AC-010 | PASS | 错密码不能进业务，页面可见「用户名或密码错误」 | `t010-wrong-password.png`；Network `POST /api/sessions` 401 |
| AC-025 | PASS | 三页顶栏「已登录：it-help」+「退出」 | 同上三页截图 |
| AC-026 | PASS | 退出回登录页「当前未登录」；直开三业务地址均要求登录 | `t010-logout.png`、`t010-direct-employee.png`、`t010-direct-agent.png`、`t010-direct-knowledge.png` |

## 真实路径证据（非 Mock）

- `isMockEnabled()===false`；页面正文不含 `[Mock]`
- 浏览器请求走 Vite 代理：`http://127.0.0.1:5199/api/sessions`（POST 401 再 200）、`/api/sessions/current`（GET 200，带 Authorization）
- 知识库为空列表「还没有知识文档…」，与 Mock 种子列表不同

## 未验 / 责任外

- 知识入库、列表筛选、分块预览、改标签/FAQ：T-011
- 员工提问 / 转人工 / 客服回复：T-012 / T-013
- 用户门禁端口 5175 / 8003：本轮未启；CORS 已对 5175 Origin 做 OPTIONS 抽检
- lint / type-check / build：本轮未重跑（联调以页面与接口为准）

## 观察（不计入失败）

- UI-01 示例失败文案为「用户名或密码不正确」，真实 401 / 页面展示为技术方案 API-001 的「用户名或密码错误」。AC-010 与技术项要求 401 文案可见，按接口契约判定通过。
- 登录页说明仍写出演示账号（含密码明文）。密码输入框为掩码。不计入本任务 AC；报告不抄密码。

## 经验候选

无。
