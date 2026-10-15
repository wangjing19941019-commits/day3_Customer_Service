# T-043 Tester 报告

- 任务：T-043 后端：提示模板版本、灰度、回滚、评测与告警
- 类型：backend；`acceptanceCriteria=[]`；`source_feature=F-006`（REQ-009）
- 总结果：**PASS（后端阶段）**
- 时间：2026-09-23
- 业务 AC-063～AC-066 由 T-049 真实验收，本任务不判页面联调、不启 8099、不调百炼

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- pytest-timeout 2.4.0 已安装；命令带 `--timeout=120`
- 工作目录：`Projects_Repo/Customer_Service`
- 未启动 8099，未杀死 8099，未调用百炼
- 测试库：各用例 `tmp_path/test.db`；未对运行时 `backend/data/Customer_Service.db` 做 drop/清表
- 运行时库：验收后仍存在，长度 622592 字节；`users` 表可读。测试未改写该文件
- 配置：`template_gray_percent` / `eval_min_items` / `alert_*` 经 `ConfigManager.get` 读 raw `.env`；报告不写口令、Token 或密钥
- 未改业务代码、`.sdd/tasks.json`、PRD、tech-spec；未执行 Git

调度：`execution_mode=automatic`；`sdd_dispatch.py --running-task T-043` 输出 `gate_phase=frontend_in_progress`（T-035）、`step_phase=not_applicable`、T-043 已在 `in_flight_or_queued`。本轮为已在途验收收尾，非新派发。依赖 T-036 状态为 passed。后续业务验收任务为 T-049。

## 实际命令

```
.venv\Scripts\python.exe -m pytest backend/tests/test_prompt_templates.py backend/tests/test_evaluation_sets.py --timeout=120 -q
```

- 退出码：0
- 结果：`14 passed, 89 warnings in 19.95s`
- 未跑 `test_documents` / `test_tickets` / `test_workspace_settings`

警告均为 Starlette/Pydantic 弃用提示，不计入判定。

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | admin 保存退货售后模板 | PATCH `/api/prompt-templates/{id}` | 200 信封；`version/editor/edited_at/change_summary` | pytest `test_save_creates_version_with_editor_and_summary` | 200；`version=2`；`editor=admin`；`change_summary=补充退货说明`；`edited_at` 非空 | PASS |
| TC-01b | 保存后对比 v1/v2 | GET `.../versions?from=1&to=2` | `versions` 含两版；`diff` 可见正文差异 | pytest `test_versions_can_diff` | 200；diff 含「版本二正文差异标记」 | PASS |
| TC-01c | 预览含情绪/订单/政策的测试说法 | POST `.../preview`；拦截发出路径 | 占位已替换；不调用 chat/polish/agent_reply | pytest `test_preview_replaces_placeholders_without_emit_path` + 读 `TemplateService.preview` | 200；`rendered_body` 含「生气」「JD20260922001」「七天无理由退货」且无 `{{emotion}}/{{order}}/{{policy}}`；monkeypatch 爆炸函数未被调用。实现仅 `render_placeholders`，无百炼 | PASS |
| TC-01d | 一线坐席 `agent` | 打开正文/保存/预览/版本/灰度/回滚/评测导入 | 403 `FORBIDDEN` | pytest `test_frontline_agent_forbidden_on_template_write_and_eval`、`test_frontline_agent_cannot_import_evaluation_set` | 列表及上述写操作均为 403，`error_code=FORBIDDEN`。路由均为 `require_roles("admin")` | PASS |
| TC-02a | 无评测集 | POST `.../releases` version=2 | 409；文案「没有不少于 5000 条的评测集，不能开始灰度」 | pytest `test_gray_without_eval_set_is_409` | 409，`error_code=CONFLICT`，文案一致 | PASS |
| TC-02b | 评测集 20 条 / 4999 条 | 导入后灰度 | 导入 200；灰度仍 409 | pytest `test_gray_below_min_items_is_409`、`test_small_eval_set_does_not_unlock_gray` | item_count=20 与 4999 均 200；releases 409，同一中文错误 | PASS |
| TC-02c | 评测集 5000 条 | POST releases 不传 gray_percent | 200；`gray_percent` 默认 5；`gray_version=2`，`stable_version=1` | pytest `test_gray_with_min_items_defaults_percent_and_rollback_uses_stable` | 200；`gray_percent==5` | PASS |
| TC-02d | 灰度后 rollback，再解析新会话 | POST rollback；新 conversation 选版 | 新会话用稳定版；已绑定灰度会话不中途换版 | 同上用例 + 读 `resolve_conversation_version` / `rollback` | rollback 后 `gray_version=None`、`stable_version=1`、`gray_percent=0`；已绑定灰度会话仍为 v2；新 cid 按稳定版 1。`resolve_conversation_version`：`gray_version is None` 时走 stable | PASS |
| TC-02e | 近 30 分钟 10 次拦截、基线为空 | GET `/api/prompt-template-alerts` | 出现该模板 `compliance_intercept_rate` 告警 | pytest `test_intercept_rate_spike_creates_alert` | 200；alerts 含对应 `template_id` 与 metric。阈值读 `alert_intercept_delta=0.20`、`alert_intercept_min_n=10`、`alert_window_minutes=30` | PASS |
| TC-03a | `.env.example` | 读字段名 | 含 `template_gray_percent` / `eval_min_items` / `alert_intercept_delta` / `alert_intercept_min_n` / `alert_window_minutes`；无密钥片段 | pytest `test_env_example_lists_template_alert_keys` + 独立读文件 | 五行均为 `key=占位`；全文无 `sk-`、无 `Bearer ` | PASS |
| TC-03b | 无 Key 预览 | POST preview | 本地占位替换可用 | pytest `test_preview_works_without_llm_key` + 读 preview 实现 | 200；订单号已代入。preview 不读 `llm_api_key`、不发模型请求 | PASS |

## 业务 AC（本任务不验收）

| AC | 责任任务 | 本轮 |
| --- | --- | --- |
| AC-063 保存版本号/修改人/时间/对比 | T-049 | 未跑页面；后端字段已由 TC-01a/b 覆盖 |
| AC-064 预览占位且不发出坐席回复 | T-049 | 未跑页面；后端由 TC-01c/TC-03b 覆盖 |
| AC-065 满 5000 约 5% 灰度、回滚、不足不可用 | T-049 | 未跑页面；后端由 TC-02 覆盖 |
| AC-066 拦截率升高告警 | T-049 | 未跑页面；后端由 TC-02e 覆盖 |

## 范围外（不计入本任务判定）

- ORM 表类写在 `backend/src/services/templates.py`（仍注册到 `src.db.models.Base`），未迁入 `db/models.py`。编排器禁止本轮为此改代码。
- `resolve_conversation_version` 尚未被会话打开路由调用；新会话选版由 T-049 联调。本任务 API 回滚后 `gray_version` 已清空，选版函数对新 cid 返回稳定版。
- API-031 抽取准确率/采纳率等切片目前除拦截率外为 0 占位；T-043 technicalChecks 未要求真实指标计算。
- 运行时 `Customer_Service.db` 的 `users` 表无 `role` 列，属既有库未迁，与本轮 tmp 测试库无关。

## 结论

当前任务 `acceptanceCriteria=[]`，technicalChecks 全部独立复验通过，后续业务验收已指定 T-049。总结果 **PASS（后端阶段）**。该 PASS 不证明 AC-063～066 用户路径已通过。
