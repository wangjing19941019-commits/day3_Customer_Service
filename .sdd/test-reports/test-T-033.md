# T-033 Tester 报告

- 时间：2026-09-23
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`d0eb8a07-f9dc-4872-90a4-119d4cbe3422`
- Tester：本轮编排器派发的 Tester
- 模式：automatic；`sdd_dispatch.py` 输出 `gate_phase=frontend_in_progress`，`gate_task_id=T-035`，`tester_ready` 含 `T-033`
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`type=frontend`，`acceptanceCriteria=[]`，仅验两条 `technicalChecks` 的 Mock 行为。关联 AC-067～069、076、077 的业务验收由联调 **T-050** 关 Mock 真实验收。本 PASS 不计业务 AC，不代替 T-035 门禁，不等于用户已放行。
- Tester **未改** 业务代码、`.sdd/tasks.json`、Git、`experience.md`。

## 环境

- 工作目录：`frontend/`；Tester 自起预览 `http://127.0.0.1:5293/`（`$env:VITE_USE_MOCK='true'; npx vite --host 127.0.0.1 --port 5293 --strictPort`，HTTP 200，VITE v8.3.0）。未占用/未关闭 5175、8099、5216、5288、5291。
- Mock：浏览器 JS；未把真实 `/api` 当证据。未调用付费 LLM。
- 账号：管理 `admin`；一线坐席 `agent`（口令未写入本报告）
- 视口：1440×900。无头 Chrome 153.0.8010.48 + CDP **9473**；独立 `user-data-dir` `t033-chrome-*`
- 指纹（SHA256 前 16 位）：
  - `pages/TicketListPage.tsx` `CD1A4611761F24FD`
  - `hooks/useTicketList.ts` `4C8A3C8517AF5A06`
  - `services/ticketListService.ts` `26A78D60B53CADAC`
  - `mocks/ticketList.ts` `FEDDFE4443C5AD0E`
  - `types/ticketList.ts` `4B477D6220F352C8`
- 质量抽检：`npx eslint` 针对本任务 write_scope ts/tsx 退出码 0。Developer 自验 type-check / lint / build 通过；本轮未因并行 T-034 全量重跑 `tsc`/`build`。
- 证据：`.sdd/test-reports/t033-browser-evidence.json`、脚本 `t033-browser.mjs`、截图 `t033-*.png`
- 验收后已关掉本轮 Chrome/CDP；5293 仍在（本轮 Tester 预览，未关 5175/8099/5216/5288/5291）

## 检查表

`acceptanceCriteria=[]`。下列为 `technicalChecks` 拆出的场景。全部为 Mock。

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | admin 打开 `/tickets` | `admin` 登录后点「工单列表」 | 筛选条与表格可见；列含工单号、类型、紧急程度、状态、处理人、更新时间 | Chrome 点击 + DOM | 路径 `/tickets`；筛选有类型/状态/紧急程度/订单号/用户/工单号/起止时间；表头六列齐全 | PASS（Mock） |
| TC-01b | 空结果 | 工单号填 `NO-SUCH` 再筛选 | 文案「当前没有符合条件的工单」 | 点击 + `t033-empty.png` | 空态精确该句；表格隐藏、0 行 | PASS（Mock） |
| TC-01c | VIP / 高风险视觉 | 对照 UI-05 | VIP 行 Warning 浅底；高风险 Danger 文字，不要整行大红 | 计算样式 + `t033-admin-list.png` | VIP `rgba(180, 83, 9, 0.12)`；高风险字 `rgb(180, 35, 24)=#B42318`；未选高风险行底 `rgb(255,255,255)`，选中行底 PrimarySubtle `rgb(232,241,250)`，均非大红底 | PASS（Mock） |
| TC-01d | 一线坐席 | `agent` 登录后打开 `/tickets` | 打不开本页，不留在 `/tickets` | 导航 + `t033-agent-blocked.png` | 被送到 `/agent`；侧栏只有「客服端」；无工单表格 | PASS（Mock） |
| TC-01e | Mock 标识 | 列表与登录态 | 带 `[Mock]` | DOM | 标题 `[Mock] 工单列表`；顶栏 `[Mock] admin` / `[Mock] agent` | PASS（Mock） |
| TC-02a | 五态演示 | 默认列表 | 待处理/处理中/挂起/已完成/已关闭都能看到 | DOM | 十行种子含这五态；点「挂起」只剩 2 张挂起 | PASS（Mock） |
| TC-02b | 点行进度 | 点仓储挂起单、VIP 开票单 | 只读进度可见仓储/财务回写；本页不编辑模板 | 点击 + `t033-readonly-progress.png` | 区标题「只读进度」；仓储未接单/等仓储确认；财务已发起开票；无「保存新版本/灰度/评测」 | PASS（Mock） |
| TC-02c | 检索 | 类型、紧急程度、订单号、用户、工单号、时间 | 只看到符合条件的工单 | 逐项筛选 | 退换货 3 张；VIP 2 张；订单 `AP20260922021` / 用户「李芳」/ 工单 `A002` 各 1 张；9/23 时间窗 2 张当天单 | PASS（Mock） |
| AC-067～069、076、077 | 真实联调 | 本任务不验 | 归 T-050 | 契约 | 未关 Mock | 不计入；后续任务 |

## 未验 / 责任外

- 业务 AC-067～069、076、077：关闭 Mock 后由 **T-050** 真实验收。AC-078～081 同属 T-050，本任务未覆盖。
- 用户门禁：唯一 `user_gate` 在 **T-035**。本 PASS 不放行门禁，不代替跨页收口。
- 真实 API-020～023、关 Mock、5175 用户验收端口：本轮未启。

## 观察（不计入失败）

- 点行后的进度区除只读时间线外，还有认领/挂起/完成/上调紧急程度按钮，用于演示 API-021～023 的 Mock，不是模板编辑。UI-05「本页不编辑核心模板」已满足。
- 列表 DTO 比 API-020 多 `id`、`updated_at`，以便选行和展示「更新时间」列；页面展示与 UI-05 列一致。真实字段以 T-050 联调为准。

## 门禁提示（交编排器）

本任务不是 T-035。Tester PASS ≠ 用户已放行。不要开始 T-050 当真验收。

预览（Mock）：`http://127.0.0.1:5293/`

```
cd frontend
$env:VITE_USE_MOCK='true'; npx vite --host 127.0.0.1 --port 5293 --strictPort
```

账号：`admin` / 与演示口令相同；坐席 `agent` 不应出现工单列表。
