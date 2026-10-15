# SDD 项目

本项目由 SDD Harness 管理。身份、项目类型和规范选择见 `.sdd/project.json`（id：`Customer_Service`，名称：智能客服系统）。

- `docs/PRD.md`：需求、业务规则和验收标准。
- `docs/tech-spec.md`：技术方案、接口与数据约定。
- `.sdd/tasks.json`：任务和运行状态，由编排器维护，不是页面功能导航的数据源。
- `docs/ui-style.md`：有界面时的设计风格，由 UI Skill 生成并供实现、验收引用。
- `docs/prototypes/`：可选界面设计。
- `.sdd/`：阶段摘要、工作日志、经验与验证报告。

`specification` 为集合名称时按需读取该集合，为 `null` 时不加载规范集。核心工作规则位于 Harness 根目录；本项目 `AGENTS.md` 提供轻量入口。

## 页面功能导航

需求方查看「每个页面能做什么、流程/接口/算法在哪」请打开：

- [docs/project-console.html](docs/project-console.html)
- 结构化说明数据：[docs/project-map.json](docs/project-map.json)

打开方式（二选一，无业务或付费调用、不调百炼）：

1. 短时静态服务（可点「重新加载 project-map.json」）：在 `docs/` 目录执行 `python -m http.server 8765 --bind 127.0.0.1`，浏览器打开 `http://127.0.0.1:8765/project-console.html`。
2. 直接用浏览器打开该 HTML 的 `file://` 路径。旁路 fetch 可能被拦，页面会改用内嵌快照，功能卡片仍可导航与展开。

本机 Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`。

不要把本页当成旧的六区管理看板（项目概况 / 启动指南 / 验收看板 / 决策看板等）。左侧按实际页面：登录、员工端、客服端、知识库、工单列表、模板管理。

## 刷新方式

1. 按页面调用链核对源码（LoginPage / EmployeeChatPage / AgentInboxPage / KnowledgePage / TicketListPage / TemplateAdminPage → services → `backend/src/api/routes` → ticket / assign / sla / templates / polish / adapters / ingest / qa / handoff / `utils/text.py` / `integrations/bailian.py`），更新 `docs/project-map.json` 的可机器提取字段（路由、method/URL、函数名、`files` 指纹）。配置只读 `AppSettings` 与 `.env.example`，不要读真实 `.env`、日志、数据库或上传文件。亦可运行 `.sdd/tmp-t028/refresh_map.py` 生成后再人工复核算法描述。
2. 把更新后的 JSON 同步进 `docs/project-console.html` 的 `#embedded-map`（file:// 回退用），或在已用静态服务打开时点 **重新加载 project-map.json**。
3. **算法步骤是人工归纳。** 若某算法 `baseline_fingerprints` 与 `files` 当前指纹不一致，控制台会把该算法从「源码已核对」降为「来源已变化待复核」。只改 `generated_at` 不能冒充已重新核对；必须定向重读源码后再改基线指纹。
4. 来源缺失或 JSON 损坏时，控制台给出降级提示，不再把损坏数据标成已核对。展示文本均经转义。

隔离样例（不改业务代码；可在控制台按钮或查询参数触发）：

| 样例 | 打开方式 | 预期 |
| --- | --- | --- |
| 源码指纹已变 | `?sample=stale` | 依赖 `backend/src/utils/text.py` 的算法（切块/余弦）显示「来源已变化待复核」，不得继续「源码已核对」 |
| 来源缺失 | `?sample=missing` | 依赖 `backend/src/services/qa.py` 的提问状态机显示「未找到实现」 |
| JSON 解析失败 | `?sample=invalid` | 红色解析失败提示，不渲染功能卡片 |

辅助核对（可选）：`?expand=all` 展开全部来源；`?copytest=1` 尝试复制第一条路径，无安全剪贴板时出现「请手选」输入框；`?focus=api-001` 或 `#api-001` 滚动到对应卡片。可与 `sample` 组合，例如 `?sample=stale&expand=all&focus=alg-chunk`。

## 运行入口（业务系统，不是本导航）

前端（Agent 开发口 5199；用户门禁曾用 5175）：

```
cd frontend
npm run dev -- --host 127.0.0.1 --port 5199
```

后端：

```
cd backend
PYTHONPATH=.. python -m uvicorn src.main:app --host 127.0.0.1 --port 8099
```

不要为查看导航去杀已占用的 5199/8099。配置字段名见 `backend/.env.example` 与 `frontend/.env.example`；本 README 不写密钥或真实 `.env` 取值。
