# T-040 Tester 报告

- 任务：T-040 后端：工单证据附件 API-018 与当次反馈 API-019
- 类型：`backend`；`acceptanceCriteria=[]`；`source_feature=F-005`（REQ-005、REQ-008）
- 总结果：**PASS（后端 technicalChecks）**
- 时间：2026-09-23
- 业务 AC-083 由 T-046 真实验收；AC-062 由 T-047 真实验收。本轮不判真实浏览器/管理端可见性，不判润色稿赔付金额。
- Tester 未改业务代码、未改 `.sdd/tasks.json`、未 Git 写操作、未杀 8099、未跑其他测试文件。未打印 `backend/.env`、未调用真实百炼。

## 环境与版本

- 解释器：`Projects_Repo/Customer_Service/.venv/Scripts/python.exe`（Python 3.13.15）
- 工作目录：`c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- pytest 9.1.1；pytest-timeout 2.4.0；timeout method=thread；timeout=120s
- 命令：`.venv\Scripts\python.exe -m pytest backend/tests/test_ticket_attachments.py backend/tests/test_result_feedbacks.py --timeout=120 -v`
- 结果：collected 7；**7 passed**；76 warnings；15.44s；exit 0
- 隔离库：pytest `tmp_path` + FastAPI TestClient；未连 8099，未写业务库，未写入真实 `backend/data/`
- 附件路径：测试把 `upload_dir` 指到 `tmp_path/uploads`；断言文件落在 `{upload_dir}/tickets/` 且 `stored_path` 以 `tickets/` 开头。生产默认 `upload_dir=data/uploads`，相对 `_BACKEND_DIR`（`backend/`）解析为 `backend/data/uploads/tickets/`
- `sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-040`：exit 0；`execution_mode=automatic`；`step_phase=not_applicable`；`gate_phase=passed`（T-035）；`in_flight_or_queued` 含 T-040、T-041。本轮只收尾 T-040，不续派。T-040 为 backend，不是 integration/delivery。
- `specification=default`；rules 按任务清单加载（backend/tech-stack、layers、api-design、error-handling、workflow；shared/naming、env-policy、security）
- 依赖 T-038、T-039 均为 `passed`
- 用户已认可 Mock：T-035 `user_gate.status=passed`（2026-09-23）
- 本轮指纹用 SHA256 前 16 位 + 修改时间：
  - `DC04C27C1A707F60` `backend/src/api/routes/tickets.py` 4237B 2026-09-23 08:59:01
  - `694B9AB81F3E03F7` `backend/src/api/routes/conversations.py` 7846B 2026-09-23 08:59:06
  - `AA61A5B19102D65D` `backend/src/services/ticket_attachments.py` 9107B 2026-09-23 08:58:33
  - `AB6257E0F74D77E1` `backend/src/models/ticket_attachment.py` 1092B 2026-09-23 08:58:33
  - `C3E672007E0CC061` `backend/tests/test_ticket_attachments.py` 8597B 2026-09-23 09:01:17
  - `BA9681BEF2A22702` `backend/tests/test_result_feedbacks.py` 7385B 2026-09-23 09:00:22
- 报告不写密钥；测试配置用占位 `llm_api_key`；未读取 `backend/.env`

## 检查表

T-040 `acceptanceCriteria=[]`，按 `technicalChecks` 编号为 TC-01 / TC-02。预期来自任务描述、API-018/019、§五/§六 API-018～023、env-policy 上传落点。

| ID | 场景/输入 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| TC-01a | 费用争议草稿字段齐全、无附件，POST API-015 confirm | HTTP 409；不能确认；仍为 draft | pytest `test_fee_dispute_without_attachment_cannot_confirm` | 409；信封 `success=false`；`error=费用争议需要证据截图`；GET 工单 `status=draft`；`confirm_blockers` 含 `attachments`；`attachments=[]` | PASS |
| TC-01b | 先 409，再 POST API-018 合法 png，再 confirm | 200；可确认；附件写入工单附件目录 | pytest `test_fee_dispute_confirm_after_valid_image` | 上传 200；`attachments` 长度 1、`filename=evidence.png`；磁盘 `{upload_dir}/{path}` 存在且字节与 PNG 一致；`{upload_dir}/tickets` 为目录；confirm 200，`status=pending` 且有 `ticket_no`；blockers 不再含 `attachments`；SQLite `ticket_attachments.stored_path` 以 `tickets/` 开头 | PASS |
| TC-01c | 非法扩展名 txt / gif | HTTP 400「请重新上传」 | pytest `test_illegal_attachment_extension_is_400` | txt 与 gif 均为 400；`error=请重新上传`；`error_code=VALIDATION_ERROR`；tickets 目录无落盘文件 | PASS |
| TC-02a | 一线坐席 POST API-019 `rating=useless` `comment=无用` `target=polish` | HTTP 200；模板正文不变 | pytest `test_agent_feedback_is_200_and_does_not_change_template_body` | 200；信封成功；`data` 恰为 7 键；`rating=useless`、`comment=无用`、`template_version=1`；全部模板 GET body 与反馈前相同；`prompt_template_versions.body` 未改；`result_feedbacks` 行 `useless`/`无用` | PASS |
| TC-02b | 员工 POST API-019 | HTTP 403 | pytest `test_employee_feedback_is_403` | 403；`error_code=FORBIDDEN`；`error=没有权限` | PASS |
| TC-02c | 附件写入 `backend/data/` 下工单附件目录 | 相对 `upload_dir/tickets/`；默认 `data/uploads` → `backend/data/uploads/tickets/` | pytest 隔离目录 + 对照 `AppSettings.upload_dir` 默认、`resolve_upload_dir`、`_TICKETS_SUBDIR=tickets` | 测试未写真实业务盘，写隔离 `{tmp}/uploads/tickets/`。默认 `upload_dir=data/uploads`，相对路径拼 `_BACKEND_DIR`（`backend/`），工单子目录 `tickets/`。env-policy 落点 `backend/data/uploads/` | PASS（隔离 Mock 路径；真实盘归 T-046） |

附加定向核对（支撑 technicalChecks，不新增需求）：

| ID | 核对 | 实际 | 结果 |
| --- | --- | --- | --- |
| AUX-01 | API-018 URL / 信封 / 允许扩展名 | `POST /api/conversations/{id}/ticket/attachments`；`response_model=APIResponse[TicketPublic]`；`ALLOWED_ATTACHMENT_SUFFIXES={.png,.jpg,.jpeg,.webp}`；非法走 `ApiError(..., VALIDATION_ERROR, 400)` | PASS |
| AUX-02 | API-019 URL / 请求与响应字段 | `POST .../result-feedbacks`；`ResultFeedbackCreate`：`rating` useful\|useless、`comment` 0～500、`target` extract\|knowledge\|polish；`ResultFeedbackPublic` 七字段与 §二一致；`create()` 只插入 `result_feedbacks`，不写 `prompt_template_versions.body` | PASS |
| AUX-03 | 会话不存在 | 附件与反馈均 404 `NOT_FOUND`（`test_attachment_missing_conversation_is_404`、`test_feedback_missing_conversation_is_404`） | PASS |
| AUX-04 | 断言有效性 | 用例使用 HTTP 状态、信封、错误文案、磁盘文件、SQLite 行断言；非只打印布尔 | PASS |
| AUX-05 | 真实浏览器 / AC-083 润色赔付 / AC-062 管理端列表与坐席无模板保存入口 | 本任务不要求；后续 T-046 / T-047 | 不判 PASS |

## 实际执行

```
python scripts/sdd_dispatch.py --tasks .../Customer_Service/.sdd/tasks.json --running-task T-040
# exit 0；execution_mode=automatic；gate_phase=passed (T-035)
# in_flight_or_queued=["T-040","T-041"]

.venv\Scripts\python.exe -m pytest backend/tests/test_ticket_attachments.py backend/tests/test_result_feedbacks.py --timeout=120 -v
# collected 7 items
# backend/tests/test_ticket_attachments.py ....   [ 57%]
# backend/tests/test_result_feedbacks.py ...     [100%]
# 7 passed, 76 warnings in 15.44s
# 警告来自 Starlette TestClient / Pydantic datetime.utcnow，不计入本任务
```

未绑定、未启动、未结束 8099。未跑其他 `backend/tests/*.py`。未触碰 Vite 5175/5199。

用例清单：

- `test_ticket_attachments.py`（4）：`test_fee_dispute_without_attachment_cannot_confirm`、`test_fee_dispute_confirm_after_valid_image`、`test_illegal_attachment_extension_is_400`、`test_attachment_missing_conversation_is_404`
- `test_result_feedbacks.py`（3）：`test_agent_feedback_is_200_and_does_not_change_template_body`、`test_employee_feedback_is_403`、`test_feedback_missing_conversation_is_404`

Developer 647b15e1-26bb-4c51-a855-ca1d17d3f8e2 自称 7 passed；Tester 独立重跑同样 7 条，exit 0。

## 判定

| 项 | 结果 |
| --- | --- |
| 业务 AC | 无（空数组）。AC-083 → T-046；AC-062 → T-047 |
| TC-01 | PASS |
| TC-02 | PASS |
| **总结果** | **PASS（后端 technicalChecks）** |

范围外：jpg/jpeg/webp 仅核对允许集常量，未各上传一次（TC 要求合法图片，pytest 用 png）。管理端反馈列表、坐席无保存模板入口、润色稿不得新编赔付金额，均不计入本轮。

未写经验库。无 FAIL、无 BLOCKED。
