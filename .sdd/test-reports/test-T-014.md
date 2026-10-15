# T-014 验收报告

- 任务：T-014 生成或刷新页面功能导航
- 总结果：**PASS**
- 类型：`delivery`（DEL-001～005 为框架交付，不计入业务 AC）
- 未改 `tasks.json`、业务代码、PRD；未 Git；未读 `.env`；未调百炼；未打 5199/8099 业务接口
- 验收结束已关闭本轮静态服务 **8766**；未杀 5199 / 8099 / 他人占用的 8765

## 环境

| 项 | 实际 |
| --- | --- |
| 打开方式 | README：`docs/` 下 `python -m http.server`；8765 已被 PID 12192 占用，本轮改用 **8766** |
| URL | `http://127.0.0.1:8766/project-console.html` |
| 浏览器 | 无头 Chrome 153 + CDP **9433**，user-data-dir `t014-chrome-*`（未占用 9413/9415/9395/9368/9357/9379/9383/9388） |
| 派发 | `sdd_dispatch.py`：`gate_phase=passed`，`tester_ready=["T-014"]`，`execution_mode=automatic` |
| 产物指纹 | `docs/project-map.json` 所列 51 个文件 sha256/bytes 与磁盘一致；`#embedded-map` 与 JSON 文件相同 |
| 网络 | CDP `Network.requestWillBeSent` 仅 8766 的 html/json/favicon，无 5199/8099/dashscope |

## 逐 DEL

| ID | 结果 | 实际 | 证据 |
| --- | --- | --- | --- |
| DEL-001 | **PASS** | 左侧按登录/员工端/客服端/知识库组织；功能卡可点导航并展开「来源」。桌面 1280：两列 `220px + 880px`，navRight=mainLeft=303，无水平溢出。窄屏 375：单列、无水平溢出。无「项目概况 / 启动指南 / 验收看板 / 决策看板」。 | `t014-browser-evidence.json` `steps.desktop` / `narrow`；截图 `t014-desktop.png`、`t014-narrow.png` |
| DEL-002 | **PASS** | 8 个功能均有触发、输入输出、带 actor/action/data/branch 的流程。API-001～012 / EXT-001～002 的 method+URL 与 `sessions.py` / `documents.py` / `conversations.py` / `bailian.py` 一致；功能卡片内接口链接可跳到 API-001（`POST /api/sessions`）。共享接口引用可到达。 | 指纹脚本 `apis_ok` / `all_features_have_flow`；浏览器 `del002-api-jump` |
| DEL-003 | **PASS** | 登录：bcrypt+JWT HS256。入库：`convert_file_to_markdown` 后再 `chunk_markdown(800,160)`。召回：对象标签交集 + 诉求子集回退，TopK=5、min_score=0.55。反问：`clarification_round < clarification_max_rounds=5` 否则兜底。转人工：只改 `handed_off`，客服回复不经 LLM。参数来自 `AppSettings` 与 `.env.example`（未读 `.env`）。百炼仅为 httpx 外部模块；`agent=null`，无 Plugin/工单/Agent 工具。 | 源码对照 + 页面展示 800/160/反问上限/httpx；`t014-fingerprint-evidence.json` `alg_notes` / `module_kinds` |
| DEL-004 | **PASS** | 功能/接口/算法均有 sources 与核对状态；设计差异与「本交付未跑真实登录/上传」写在 runtime_verification。浏览器：导航、展开来源、点接口、复制失败出现「请手选」输入框（`backend/src/api/routes/sessions.py`；`?copytest=1` 为 `frontend/src/pages/LoginPage.tsx`）。无业务/付费调用。 | `steps.copyLive` / `copytest`；`forbiddenNetwork=[]`；`t014-copytest.png` |
| DEL-005 | **PASS** | 点「重新加载 project-map.json」出现「已从 project-map.json 重新加载」。`?sample=stale`：alg-chunk / alg-cosine-faq 降为「来源已变化待复核」，登录算法仍「源码已核对」。`?sample=missing`：qa 相关算法「未找到实现」，切块仍已核对。`?sample=invalid`：红色解析失败，不渲染功能卡片。本 Tester 未改业务代码或任务状态。 | `steps.stale` / `missing` / `invalid` / `reload`；截图 `t014-sample-stale.png`、`t014-sample-missing.png`、`t014-sample-invalid.png` |

## 技术检查

| ID | 结果 | 说明 |
| --- | --- | --- |
| TC-01 浏览器导航/展开/跳转/复制/窄屏 | **PASS** | 见 DEL-001/002/004。窄屏截图为滚动到 API-001 后的卡片，文案折行、无整页横向溢出。 |
| TC-02 源码核对登录、切块 800/160、标签召回、反问 5 轮、转人工；参数来自配置定义 | **PASS** | `AppSettings.chunk_max_chars=800`、`chunk_overlap_chars=160`、`clarification_max_rounds=5` 与 `.env.example` 一致。`run_ingest_job` 先转 Markdown 再切块。`filter_chunks_for_issue` 做对象∩与诉求子集。指纹脚本对 `jwt_expire_minutes` / `llm_base_url` 的空值是正则漏匹配，**直接读 `session.py` 第 39、41 行分别为 720 与 dashscope 基址**，与 map/参数卡一致。 |
| TC-03 百炼 httpx；不编造 Plugin/工单；隔离样例 | **PASS** | `BailianClient._post` 使用 `httpx.AsyncClient(trust_env=False)`。map `not_present` 与模块 kind 无 Agent 工具。隔离样例见 DEL-005。 |

## 执行摘要

1. 派发检查允许 Tester；write_scope 仅为导航产物，本轮只写测试报告与一次性验收脚本。
2. 静态核对：51 个 `files` 指纹匹配；HTML 内嵌 map 与 `project-map.json` 相同；无旧六区文案、无密钥取值。
3. 真实浏览器走完导航、展开、接口跳转、手选复制、桌面/窄屏、刷新按钮与三类隔离样例。

## 范围外（不计入）

- 8765 上已有他人 `python -m http.server`（PID 12192），未使用也未关闭。
- 未启动或调用业务前端 5199 / 后端 8099。
- 指纹脚本 `params_ok=false` 仅因解析器未吃到带 URL 的两行默认值，不以该脚本项判定失败。

## 证据路径

目录：`Projects_Repo/Customer_Service/.sdd/test-reports/`

- 报告：`test-T-014.md`
- JSON：`t014-browser-evidence.json`、`t014-fingerprint-evidence.json`
- 脚本：`t014-browser.mjs`、`t014-fingerprint.py`
- 截图：`t014-desktop.png`、`t014-narrow.png`、`t014-sample-stale.png`、`t014-sample-missing.png`、`t014-sample-invalid.png`、`t014-copytest.png`
