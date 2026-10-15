# T-028 验收报告（主对话降级模式，非独立验收）

- 任务：T-028 刷新页面功能导航（确认后工单与管理端增量）
- 总结果：**PASS（自验）**
- 类型：`delivery`（DEL-001～005 为框架交付，不计入业务 AC）
- 验证方式：沿用「c」与「2.A」，开发与验收同一主对话，**不是独立 Tester 复核**。
- 未改业务代码、未改其他任务状态、未 Git、未读真实 `.env`、未调百炼、未打 5199/8099。

## 验证环境

| 项 | 实际 |
| --- | --- |
| 静态服务 | `docs/` 下 `python -m http.server 8767 --bind 127.0.0.1` |
| URL | http://127.0.0.1:8767/project-console.html |
| 浏览器 | headless Chrome CDP 9570，脚本 `.sdd/tmp-t028/t028_browser.mjs` |
| 产物 | `docs/project-map.json`、`docs/project-console.html`（`#embedded-map` 同步）、`README.md` |
| 证据 | `.sdd/tmp-t028/evidence/t028-browser-evidence.json` 与截图 |

## 逐 DEL

| ID | 结果 | 实际 |
| --- | --- | --- |
| DEL-001 | PASS | 左侧六页：登录/员工端/客服端/知识库/工单列表/模板管理；无旧六区文案；桌面与 375 窄屏无水平溢出 |
| DEL-002 | PASS | 功能可展开见流程/接口/来源；接口链接可跳转 |
| DEL-003 | PASS | 分配/SLA、工单抽取等算法步骤可见；参数来自配置定义叙述 |
| DEL-004 | PASS | 来源路径可见；`?copytest=1` 支持手选/可见路径；无业务主机请求 |
| DEL-005 | PASS | 「重新加载 project-map.json」有效；`?sample=stale/missing/invalid` 降级符合预期 |

## 产物摘要

- 页面增补：`/tickets`、`/templates`
- 功能增补：填单确认、润色、工单列表/动作、模板版本、评测灰度、金额线
- 接口覆盖：API-013～035、EXT-003～007（在原有 001～012 / EXT-001～002 基础上扩展）
- 算法增补：工单抽取、分配与 SLA、润色、模板评测、适配器
- `files` 指纹按当前磁盘重算（约 73 项）

## 未验 / 说明

- 本报告为降级自验，**不是独立验收**；经验库不落盘。
- 本交付不重跑业务联调（T-050～052 等已通过）。
- 验收后可关闭本轮 8767 静态服务；未杀业务端口。
