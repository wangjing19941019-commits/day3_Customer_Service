# T-001 Tester 报告（恢复验收）

- 时间：2026-09-12
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`086ac587-98be-4e4d-933b-2027e8982911`
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-005
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`acceptanceCriteria=[]`，仅验 technicalChecks。AC-009 / AC-010 / AC-025 / AC-026 由 T-010 承接，本轮不判真实登录 AC。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`
- 指纹：Harness HEAD `ec75f8f`；本轮独立重跑 type-check / lint / build / 浏览器，未沿用中断前口头 PASS
- 启动：`cd frontend && npm run dev -- --host 127.0.0.1 --port 5199`（Tester 启动，验收后关闭）
- URL：http://127.0.0.1:5199/ （HTTP 200，含 `#root`）
- Mock：默认开（无 `frontend/.env`；`VITE_USE_MOCK` 未设为 false）
- 视口：1440×900，无头 Chrome + CDP
- 质量命令（本轮）：type-check 0；lint 0；build 0（Vite 8.3.0，94 modules）
- 证据：`.sdd/test-reports/t001-browser-evidence.json` 与 `t001-*.png`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 开发服务与质量门 | `npm run dev` / type-check / lint / build | 5199 可开；三项按改动通过 | 启动 Vite + 本轮命令 | Vite `Local: http://127.0.0.1:5199/`；三命令退出码 0 | PASS |
| TC-02a | 未登录打开 `/employee` | 浏览器直开 | 回登录并见「当前未登录」 | Chrome CDP | pathname=`/login`，文案存在，无 token | PASS（Mock） |
| TC-02b | 空表 | 点登录 | 留在登录页，见必填说明 | Chrome CDP + 截图 | 仍 `/login`；「请输入用户名」「请输入密码」；输入红框 | PASS（Mock） |
| TC-02c | 错误密码 | `it-help` + 错密码 | 留在本页，失败说明带 `[Mock]` | Chrome CDP + 截图 | `[Mock] 用户名或密码错误`；用户名保留；密码掩码；无 token | PASS（Mock） |
| TC-02d | 正确账号 | 演示账号登录 | 进入受保护外壳 | Chrome CDP + 截图 | `/employee`，顶栏+侧栏，`localStorage.access_token` 存在 | PASS（Mock） |
| TC-03a | 已登录顶栏 | 读顶栏 | 「已登录」+ 用户名 +「退出」 | Chrome CDP + 截图 | 「已登录：[Mock] it-help」+「退出」 | PASS（Mock） |
| TC-03b | 退出后再开 `/employee` | 点退出后直开业务地址 | 回登录；token 丢弃 | Chrome CDP | `/login`，「当前未登录」，token 不存在 | PASS（Mock） |
| TC-04a | 侧栏三项 | 点客服端 / 知识库 | 互斥；非当前页不占内容区 | Chrome CDP + 截图 | 仅一个 `h1`；`aria-current=page` 随路由变 | PASS（Mock） |
| TC-04b | 刷新 | 在 `/knowledge` 刷新 | 地址与选中导航一致 | Chrome CDP | 仍 `/knowledge`，知识库选中 | PASS（Mock） |
| TC-04c | Mock 数据集中与信封 | 读 `frontend/src/mocks/` | 对齐 API-001/002 | 读 `mocks/auth.ts` | 信封含 success/data/error/error_code/message/timestamp/request_id/metadata；401「用户名或密码错误」；API-002 `data.username`；POST `/api/sessions`、GET `/api/sessions/current` | PASS（Mock） |
| TC-05a | UI-01 / 全局外壳 / 原型 01-login | 计算样式 + 截图 | 登录卡居中；顶栏 56px；主色与字阶 | Chrome CDP + 截图 | 卡 400px、padding 32px、圆角 8px、阴影符合、居中偏差 0；顶栏 56px；Canvas `rgb(244,246,248)`；主按钮 `rgb(29,78,137)` / 40px；h1 20px/600/28px | PASS（Mock） |
| TC-05b | baseURL | 读 api 与 vite 配置 | 来自 `VITE_API_BASE_URL`，无硬编码后端主机 | 读 `services/api.ts`、`vite.config.ts`、`.env.example` | `import.meta.env.VITE_API_BASE_URL \|\| '/api'`；8099 仅出现在代理目标 / example | PASS |

## 未验 / 责任外

- 真实登录 AC-009 / AC-010 / AC-025 / AC-026：T-010，关闭 Mock 后验。
- 占位页业务能力：T-002～T-004。
- 窄于 1024 布局：不在本任务 TC。
- 用户门禁预览端口 5175：T-005。

## 观察（不计入失败）

- UI-01 / 原型失败文案为「用户名或密码不正确」，页面展示 API-001 的「用户名或密码错误」。语义与 Mock 信封一致。
- 顶栏用户名为「已登录：[Mock] it-help」，满足 mock 可见标识。
- 登录页展示演示账号（与原型 01-login 一致）；密码输入为掩码。

## 经验候选

无。
