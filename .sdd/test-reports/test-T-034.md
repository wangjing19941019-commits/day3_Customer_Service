# T-034 Tester 报告

- 任务：T-034 前端：管理端模板版本、灰度、评测与金额线 Mock
- 总结果：**PASS（前端阶段 / Mock）**
- 时间：2026-09-23
- 模式：automatic；`sdd_dispatch.py` `gate_phase=frontend_in_progress`（门禁任务 T-035），`step_phase=not_applicable`
- `acceptanceCriteria=[]`。关联 AC-063～066、AC-061 仅 Mock 覆盖；业务 AC 归 **T-048 / T-049**
- 本 PASS 不计业务 AC，不代替 T-035 门禁；Tester PASS ≠ 用户放行
- 未改业务代码、未改 `.sdd/tasks.json`、未 Git

## 环境

| 项 | 值 |
| --- | --- |
| 预览 | http://127.0.0.1:5288/ |
| Mock | `VITE_USE_MOCK=true`（Vite 注入 `mockFlag.ts` 已核对） |
| 账号 | admin（模板）；agent（坐席无入口）。口令不入报告 |
| 视口 | 1440×900 |
| 浏览器 | 独立 headless Chrome / CDP 9488，临时 user-data |
| 静态 | T-034 write_scope `eslint` 通过；`tsc -b` 通过；`vite build` 通过（本轮未被 T-033 挡住） |

未占用/未结束 5175、8099、5216、5291；复用已交接 5288。

## 检查表

| ID | 场景 | 预期 | 方法 | 结果 |
| --- | --- | --- | --- | --- |
| TC-01 | admin 改退货售后模板并保存 | 新版本号 v2、修改人 admin、修改时间、修改内容；对比可见正文差异；带 [Mock] | 点击保存 + DOM | PASS |
| TC-02 | 输入含订单/政策/情绪的测试说法并预览 | 占位换成生气 / JD20260922001 / 七天无理由退货；无对话气泡；无 completions/messages 请求；会话 store 未变 | 点击预览 + 网络探针 | PASS |
| TC-03 | 评测集 0 条 | 「灰度约 5%」禁用，原因「没有不少于 5000 条的评测集，不能开始灰度」 | 初始态 | PASS |
| TC-04 | 导入 `{"item_count":5000}` 后灰度 | 按钮可用；发布后列表「灰度 v2 5%」 | 导入 + 点击 | PASS |
| TC-05 | 回滚 | 提示「新会话将使用该版本」；列表灰度消失 | 点击回滚 | PASS |
| TC-06 | 3C 退换货行告警 | 「合规拦截率突然升高」，颜色 `#B42318` / `rgb(180, 35, 24)` | 计算样式 + 截图 | PASS |
| TC-07 | 编辑区主按钮 | 只有「保存新版本」为 `btn-primary`；灰度/回滚/预览为次按钮 | DOM | PASS |
| TC-08 | Mock 标识 | 标题、列表、告警、版本均带 `[Mock]` | DOM | PASS |
| TC-09 | 坐席 agent | 侧栏仅「客服端」；直开 `/templates` 被送回 `/agent` | 登录 + 导航 | PASS |
| TC-10 | 金额线 | 保存 8888 后可读；清空后 `null` / 「未配置金额线」 | 点击保存/清空 | PASS |
| TC-11 | 对照 UI-06 | 左列表 320px、右编辑；左列表右编辑 | 布局 + 截图 | PASS |

业务 AC：`acceptanceCriteria=[]`。后续责任：T-048（AC-061）、T-049（AC-063～066）。

## 实际结果（脱敏）

1. admin 登录后进 `/knowledge`，侧栏「知识库 / 工单列表 / 模板」，打开 `/templates`。
2. 3C 数码 · 退换货 · 售后 行右侧红色告警「[Mock] 合规拦截率突然升高」。
3. 评测 0 条时灰度按钮 disabled，文案写明不足 5000。
4. 保存后：「[Mock] 新版本 v2 · admin · 2026/9/23 08:36:43 · T034-tester 退货售后说明补充」；diff 可见 `+【T034修订】`。
5. 预览正文：「[Mock] 【T034修订】请结合用户情绪生气、订单JD20260922001与政策七天无理由退货给出售后说明。」无坐席回复、无回复路径请求。
6. 金额线 8888 已保存；清空后未配置。
7. 导入 5000 条后「可灰度」，发布显示「灰度 v2 5%」；回滚提示「[Mock] 新会话将使用该版本」。
8. agent 无模板导航；`/templates` 回到客服端。

## 证据位置

- `Projects_Repo/Customer_Service/.sdd/test-reports/t034-browser-evidence.json`（`pass: true`, `failed: []`）
- `t034-admin-templates.png` / `t034-after-save.png` / `t034-preview.png` / `t034-eval-ready.png` / `t034-rollback.png` / `t034-agent-home.png` / `t034-agent-blocked.png`
- 脚本：`t034-browser.mjs`

## 范围外（不计入判定）

- 真实 API-024～035、评测集实体文件、百炼预览：T-049。
- 坐席 403 真实验收：T-048。
- 前端 Mock 收口与用户门禁：T-035。需交用户验收 Mock 与填写后端 API 配置（本任务不代替）。
- `vite build` 提示 `conversations.ts` 动态导入无效分割，与 T-034 无关。
- 列表行标题窄列换行（「售后」落到第二行）不影响本任务检查项。
