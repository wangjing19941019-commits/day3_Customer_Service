# T-030 Tester 报告

- 时间：2026-09-23
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`0f6c08e0-9b87-49e6-8a4b-bf987db5ecb9`
- Tester：本轮编排器派发的 Tester
- 模式：automatic；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`，`gate_task_id=T-035`，`tester_ready=["T-030"]`
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验两条 `technicalChecks` 的 Mock 行为。关联业务 AC-053 / AC-059 / AC-060 由联调 **T-045** 关 Mock 真实验收。本 PASS 不计业务 AC，不代替 T-035 门禁，不等于用户已放行。
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git。

## 环境

- 工作目录：`frontend/`；复用 Developer 预览 `http://127.0.0.1:5288/`（`VITE_USE_MOCK=true`，HTTP 200）。未占用/未关闭 5175、8099，也未停其他开发者 Vite。
- Mock：浏览器 JS；未把真实 `/api` 当证据。未调用付费 LLM。
- 账号：管理身份用户名 `admin`（报告不写口令）
- 视口：1440×900；无头 Chrome 153.0.8010.48 + CDP **9460**；独立 `user-data-dir` `t030-chrome-*`，不与其他智能体会话共用
- 指纹（SHA256 前 16 位）：
  - `KnowledgePage.tsx` `56F02A4E8E4F4A3C`
  - `mocks/documents.ts` `0BCB36A36413E6CE`
  - `documentService.ts` `7E1D96E1808ADDDF`
  - `types/document.ts` `1C14F85EA63FAF77`
  - `DocumentVisibilityEditor.tsx` `A87FF4DBC272A52D`
  - `documentVisibility.ts` `24612FDFEC321B8A`
  - `knowledgeList.css` `5F215AC5454337FD`
- 质量：`npx eslint` 针对本任务 ts/tsx 退出码 0；`npm run type-check` 退出码 0（本轮全量 tsc 已通过，未再被其他任务文件挡住）
- 证据：`.sdd/test-reports/t030-browser-evidence.json`、脚本 `t030-browser.mjs`、截图 `t030-*.png`
- 验收后已关掉本轮 Chrome/CDP；5288 仍在（Developer 预览，未关）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 已完成文档保存可见范围与生效时间 | 管理身份登录 → 知识库 → 点 `服饰美妆常见问题.md` → 选「仅坐席可见」→ 填开始 `2026-03-01T09:00`、结束 `2026-06-30T18:00` → 点次按钮「保存可见范围和生效时间」 | 保存成功；当前范围为仅坐席可见；两个时间仍在；带 `[Mock]` | Chrome 真实点击 + `t030-after-save.png` | 提示 `[Mock] 已保存，将立即用于后续提问。`；`checkedLabel=仅坐席可见`；from/to 与填写一致 | PASS（Mock） |
| TC-01b | 离开再开仍在 | 先点另一篇已完成文档，再点回该篇；再 `Page.reload({ ignoreCache: true })` 后重新打开 | 仍是仅坐席可见，两个时间仍在 | CDP + `t030-reopen.png`、`t030-reload.png` | 再打开与硬刷新后再打开均为仅坐席可见 + `2026-03-01T09:00` / `2026-06-30T18:00`。列表该行更新时间为「9月23日 08:05」 | PASS（Mock） |
| TC-01c | 清空后再开为空 | 清空两个时间并保存 → 离开再打开 | 时间为空；可见范围仍可保留 | CDP + `t030-cleared.png`、`t030-cleared-reopen.png` | `from=""`、`to=""`；控件显示占位「年/月/日」；仍为「仅坐席可见」 | PASS（Mock） |
| TC-01d | 入库中没有该编辑区 | 点 `订单配送时效说明.md` | 无可见范围单选、无起止时间、无该保存按钮 | CDP + `t030-list.png`、`t030-ingesting.png` | `hasEditor=false`；`datetimeCount=0`；详情仅 `[Mock] 这篇文档正在入库中，完成后才能查看分块并修改标签、FAQ、可见范围或生效时间。` | PASS（Mock） |
| TC-01e | 对照 UI-04 例外 | 看保存按钮与主色 | 可见范围保存用次按钮，不新造主色；上传仍是主按钮 | 计算样式 + 截图 | 保存按钮 `btn btn-secondary`；背景 `rgb(255, 255, 255)`、字 `rgb(31, 41, 51)`、边框 `rgb(217, 226, 236)`（Surface / Text / Border）。上传仍是蓝色主按钮 `#1d4e89`。未新造主色 | PASS（Mock） |
| TC-02a | 三项中文文案 | 打开已完成详情 | 用户可见 / 仅坐席可见 / 高风险仅人工；不把枚举名直接给用户 | DOM + `t030-ready-editor.png` | 三个 radio 的可见标签正是这三句中文；`value` 仍为契约 code；详情正文不含 `user_visible` / `agent_only` / `high_risk_human_only` | PASS（Mock） |
| TC-02b | type-check / lint | 按改动跑 | 通过 | 命令 | eslint 本任务 ts/tsx 退出码 0；`npm run type-check` 退出码 0 | PASS |
| AC-053/059/060 | 真实召回与过滤 | 本任务不验 | 归 T-045 | 契约 | 未关 Mock，未做员工端/坐席端召回 | 不计入；T-045 |

## 定向复核

- 首轮脚本用文件名精确匹配失败：列表标题是 `[Mock] 服饰美妆常见问题.md`。改为包含匹配后重跑。这是选择器问题，不是产品缺陷。
- 脚本曾断言标签主按钮文案为「保存标签」，实际按钮是「保存」。该断言失败不计入产品缺陷；上传主按钮与可见范围次按钮已由样式和截图核对。
- `leftToOther` 采集时未等选中行切换，数值与原文档相同。复核截图：`t030-reopen.png` 选中行仍是 `服饰美妆常见问题.md`；硬刷新后的 `afterReload` 独立证明 Mock 持久化。**不计入失败。**

## 未验 / 责任外

- 业务 AC-053 / AC-059 / AC-060：关闭 Mock 后由 **T-045** 真实验收（保存字段 + 员工端/坐席端召回过滤）。
- Mock 409（入库中 PATCH）与 400（非法范围 / 结束早于开始）：页面在入库中不提供编辑区，用户点选路径无法发出 409；本轮按任务要求做点击验收，未另造非法 payload。
- 用户门禁：唯一 `user_gate` 在 **T-035**。本 PASS 不放行门禁。
- 真实 API-005/006、关 Mock、5175 用户验收端口：本轮未启。

## 观察（不计入失败）

- 详情里对象标签与可见范围的 `.kb-check` 在 1440 截图上，勾选框与中文名会分到中间/右侧并折行。三项中文名仍可读，DOM 文案正确。属视觉密度问题，未否定本任务 AC/TC。
- 界面 Mock 数据带 `[Mock]`。

## 门禁提示（交编排器）

本任务不是 T-035。Tester PASS ≠ 用户已放行。不要开始 T-045。

可复用预览（Mock）：

```
http://127.0.0.1:5288/
```

管理身份用户名 `admin`。若 5288 已不在：`cd frontend` 后 `VITE_USE_MOCK=true` 自起，避开 5175/8099 及其他开发者端口。

## 经验候选

无。
