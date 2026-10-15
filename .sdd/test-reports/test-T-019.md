# T-019 Tester 报告

- 时间：2026-09-22
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`4a100ef4-e232-4a27-99d2-d2ac495fce3e`
- Tester 实例：`f11dde07-14e7-486a-a77e-ba3295850278`
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-021；本轮是已在途的 T-019 收尾验收
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验三条 `technicalChecks`。关联 AC-001、AC-012、AC-019、AC-021 的文案与示例由本任务 TC 覆盖；业务 AC 由联调 **T-025** 真实验收。不代替 T-021 用户门禁。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`（本项目 Vite）
- 指纹：Harness HEAD `ec75f8f`；Customer_Service git 尚无 commit。改动文件 SHA256：
  - `EmployeeChatPage.tsx` `E863D070…59D1A441`
  - `conversations.ts` `C220097F…CB58610DB`
  - `ChatStatusBar.tsx` 未改 `C54F9A20…B32CCF49`
- Mock：本进程 `VITE_USE_MOCK=true`（覆盖项目 `.env` 中的 false）；页面可见 `[Mock]`
- Tester 自起 Vite：`http://127.0.0.1:5203/`，`vite --host 127.0.0.1 --port 5203 --strictPort`，HTTP 200。未占用/未关闭 5199、8099、5201、5202
- 浏览器：无头 Chrome 153 + CDP **9449**，视口 1440×900，独立 `user-data-dir` `t019-chrome-*`；验收后已关掉本轮 Chrome
- 账号：演示用户名 `it-help`（报告不写密码）
- 定向质量：`npm run type-check` 退出码 0；`npx eslint` 仅 T-019 路径（EmployeeChatPage / conversations / ChatStatusBar）退出码 0
- 证据：`.sdd/test-reports/t019-browser-evidence.json`、`t019-empty.png`、`t019-clarify.png`、`t019-dress.png`、`t019-handoff.png`；脚本 `t019-browser.mjs`

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 登录后打开员工端空会话 | 打开 `/employee` 并用演示账号登录 | 辅助句「描述你的购物问题」；不得出现「描述你的 IT 问题」；带 `[Mock]` | Chrome CDP + `t019-empty.png` | pathname=`/employee`；空态 `[Mock] 描述你的购物问题`；`hasItEmpty=false`；状态 `[Mock] AI 接待中`；可点「转人工」；空态 14px / `rgb(92,107,122)`（TextMuted）；输入钉底 `pinGap=0` | PASS（Mock） |
| TC-02a | 含糊购物问法 | 发送「能不能退」 | 反问而非兜底/猜测知识；原问与改写可见；服饰/购物口径 | CDP + `t019-clarify.png` | 员工右气泡原文「能不能退」；改写「当前问法缺少商品或订单对象…」；左侧标签「反问」，正文「请问是哪件商品？例如连衣裙、耳机，还是订单和发票问题。」；不是兜底原文 | PASS（Mock） |
| TC-02b | 连衣裙退货演示 | 再发「这件连衣裙能退吗」 | UI-02 示例：改写 + 服饰知识；发消息主路径可用 | CDP + `t019-dress.png` | 改写「询问该连衣裙是否支持退货」；标签「知识问答」；正文「服饰美妆支持七天无理由退货，需商品完好」。员工右/系统左；员工气泡 `rgb(29,78,137)` 白字 | PASS（Mock） |
| TC-02c | 转人工后再发 | 点转人工，再发「你好」 | 状态已转人工；再发送只有员工气泡、无系统自动回 | CDP + `t019-handoff.png` | 状态 `[Mock] 已转人工，等待客服`；按钮禁用为「已转人工」；系统气泡数 2→2，最后系统条仍是上一轮知识问答；新员工「你好」无改写、无闲聊/FAQ 自动回 | PASS（Mock） |
| TC-03 | type-check / lint | `npm run type-check`；eslint 改动路径 | 按改动通过；本 PASS 不计业务 AC | 命令 | 两者退出码 0 | PASS |

## 未验 / 责任外

- 业务 AC-001、AC-012、AC-019、AC-021：T-025 关闭 Mock 后真实验收。
- T-002 其余分支（5 轮反问、FAQ、闲聊、超范围兜底、刷新续聊）：本任务明确不重验。
- 用户门禁预览端口 5175：T-021。
- 客服工作台填单/知识推送：T-020。

## 观察（不计入失败）

- `MessageList.tsx` 仍保留空态句「描述你的 IT 问题」，但空会话由 `EmployeeChatPage` 渲染，实测员工端空会话 DOM 未出现该句。后续若有仅 `waiting_for_agent` 可见消息的路径，可能露出旧文案；不在本任务 TC。
- 原型 `02-employee` 连衣裙知识句比 UI-02 示例更长；实现与 **UI-02 示例数据**一致（任务明确引用 UI-02「描述你的购物问题」与连衣裙改写/七天无理由句）。布局、空态、反问、转人工与原型一致。
- 转人工后 Mock 仍可能写入 `waiting_for_agent`，页面已过滤，用户看不见系统自动回（与 T-002 观察相同）。

## 经验候选

无。
