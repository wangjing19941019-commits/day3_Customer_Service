# T-048 Tester 报告

- 任务：T-048 联调：按身份进入页面且坐席打不开模板配置
- 类型：integration；`source_feature=F-001`（REQ-004）
- 本轮范围：只验收 **AC-061**
- 总结果：**PASS**
- 时间：2026-09-23
- Tester 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git 写操作；未写入口令、Token 或密钥

调度：`execution_mode=automatic`；`sdd_dispatch.py` 输出 `gate_phase=passed`（T-035）、`step_phase=not_applicable`、`tester_ready` 含 T-048。依赖 T-035 / T-036 / T-043 均为 passed。Developer `8e9cb8a1-7dfc-4c8d-ba00-88fb97517a82` 自验 PASS 仅作环境交接，本轮独立点击与接口复验。

## 环境与版本

| 项 | 实际 |
| --- | --- |
| 前端 | http://127.0.0.1:5218/ ；进程 `VITE_USE_MOCK=false`，`VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8108`，`VITE_API_BASE_URL=/api` |
| 后端 | http://127.0.0.1:8108/ ；`t048_serve.py`，`T048_READY_DB=data/t048.db`，进程内 `llm_api_key` 为空 |
| 隔离库 | `backend/data/t048.db` 167936 字节（验收中 `last_seen_at` 心跳使 mtime 更新，体积不变） |
| 业务库 | `backend/data/Customer_Service.db` 622592 字节，mtime `2026-09-17 22:38:41`，验收前后一致，未读写 |
| Mock | 登录页 `isMockEnabled()=false`；各页 `pageHasMock=false`（无 `[Mock]` 徽章） |
| 账号 | `agent`（`frontline_agent`）/ `admin`（管理）；口令来自 `backend/.env` 的 `shared_password`，报告不写值 |
| 浏览器 | 独立 headless Chrome，CDP **9548**，临时 user-data，视口 1440×900 |
| 解释器 | 项目 `.venv` Python 3.13.15；Node v24.18.0 |
| 仓库指纹 | harness 根 `git rev-parse --short HEAD` = `ec75f8f` |
| 前端指纹（SHA256 前 16 位） | `roleNav.ts` `67F5020E5109696A`；`router/index.tsx` `AC3D5F4AB8542D70`；`TemplateAdminPage.tsx` `E398A008B77F5CD0`；`mockFlag.ts` `ED50E99695B16BAD` |

未启动、未停止 8099 / 8109 / 5219 / 5175 / 5199。验收后 5219、8109、5199、5175 仍在监听。Tester Chrome/CDP 已关闭。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| AC-061-a | `agent` 正确登录 | 打开 `/login`，填用户名 `agent` 与配置口令，点登录 | 进入客服端；侧栏无模板/灰度入口；无 `[Mock]` | Chrome 点击 | `pathname=/agent`；顶栏「已登录：agent」；侧栏仅「客服端」；`mockEnabled=false` | PASS |
| AC-061-b | 已登录坐席 | 地址栏直开 `/templates` | 不能停留在模板配置，不能改模板、不能发布 | Chrome `Page.navigate` | 回到 `/agent`；无编辑器、无「保存新版本」、无「灰度约 5%」 | PASS |
| AC-061-c | 已登录坐席 | 直开 `/tickets`（工单管理中的灰度） | 不能使用管理端灰度发布 | Chrome `Page.navigate` | 回到 `/agent`；无灰度文案 | PASS |
| AC-061-d | 坐席 Token | 页内 `GET /api/prompt-templates` | 403，`error_code=FORBIDDEN`，与页面一致 | 浏览器 fetch + 后端直连 | 页内与 8108 直连均为 403/`FORBIDDEN`/`没有权限`；保存/灰度/回滚/预览/告警/评测导入同为 403 | PASS |
| AC-061-e | `admin` 登录 | 点侧栏「模板」 | 能打开模板配置，看到保存与灰度 | Chrome 点击 | `/templates` 标题「模板配置」；主按钮「保存新版本」；正文含「灰度约 5%」；无 `[Mock]` | PASS |
| TC-01 | 真实联调非 Mock | 登录页与各业务页 | `VITE_USE_MOCK=false`；页面无 `[Mock]` 徽章 | Chrome `isMockEnabled()` + innerText | 登录/坐席/管理页均为 false；代理 `POST /api/sessions` 200 且 `role=frontline_agent` | PASS |
| TC-02 | 报告与配置 | 全程 | 不把密钥写入报告 | 人工核对产出 | 证据 JSON 只留字段名/状态；Token 已脱敏；未抄写口令 | PASS |

## 实际执行

1. 核对实例：5218 代理 8108，8108 使用 `data/t048.db`；`GET /` 与 `GET /docs` 均为 200。
2. 独立接口：`.venv` 运行 `.sdd/test-reports/t048-ac061/run-api.py`（读配置键 `shared_password`，不打印值）。
3. 独立浏览器：Node 运行 `.sdd/test-reports/t048-ac061/run-browser.mjs`（CDP 9548，不复用 Developer 的 9528 会话）。
4. 查看截图：登录、坐席首页、坐席被拦回、管理知识库、管理模板。

接口脱敏结果（8108 直连，除非注明代理）：

- `agent` 登录 200，`role=frontline_agent`
- `admin` 登录 200，`role=admin`
- `GET /api/sessions/current`（坐席）200，`role=frontline_agent`
- `GET /api/prompt-templates`（管理）200，列表 2 条
- 坐席：列表 / 正文 / PATCH 保存 / 灰度发布 / 回滚 / 预览 / 告警 / 评测导入 → 全部 HTTP 403，`error_code=FORBIDDEN`，`success=false`
- 5218 代理登录 `agent` 200，`role=frontline_agent`
- 缺百炼 Key 不阻塞登录与 403

浏览器网络：坐席态 `/api/prompt-templates` → 403；管理态同一接口 → 200，并成功拉正文/版本/指标。

## AC

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-061 | **PASS** | 坐席无模板入口，直开 `/templates` 或 `/tickets` 回客服端，不能改模板也不能发布；模板接口 403 与页面一致。管理可打开模板配置并看到「保存新版本」与「灰度约 5%」。真实 API，无 `[Mock]` 徽章。 |

## 证据位置

绝对目录：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service\.sdd\test-reports\t048-ac061\`

- `t048-browser-evidence.json`（CDP 9548，`failed=[]`）
- `t048-api-evidence.json`
- `t048-login.png` / `t048-agent.png` / `t048-agent-templates-blocked.png` / `t048-admin-home.png` / `t048-admin-templates.png`

Developer 自验目录 `.sdd/tmp-t048/` 未当作本轮判定依据。

## 未验项

- AC-009 / AC-010 / AC-025 / AC-026（不在本任务 `acceptanceCriteria`）
- 其余八个种子角色的页面分流（本轮只验 `agent` 与 `admin`）
- 管理端真正保存新版本、灰度发布成功、回滚与告警（AC-063～066，T-049）
- 评测集不足 5000 时灰度按钮禁用（页面已提示「当前 0 条，不足 5000 条不能灰度」；属 T-049，不阻塞 AC-061「能看到灰度」）

## 范围外

- 评测集提示里仍有「Mock 可用一行 …」说明（`withMockLabel` 在 `VITE_USE_MOCK=false` 时不加 `[Mock]` 前缀）。不是 `[Mock]` 徽章，不计入 AC-061 FAIL；是否清理交编排器。
- 登录页演示文案可能含账号说明；报告未抄写口令。
