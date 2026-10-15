项目：Customer_Service（智能客服，电商）
路径：c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service
规范：default。推进：automatic。PRD / tech-spec / ui-style 均为 Confirmed。
T-035 user_gate：2026-09-23 用户回复「可以的」后为 passed。百炼 llm_api_key、llm_base_url、llm_model 已在 backend/.env，非占位，不要重填、不要把值写进文档。
未做 Git。

目标
内部网页客服。未转人工只做电商知识问答，不建单。转人工后增量填单、坐席确认、知识只推给坐席、润色须坐席确认后才发送。工单只存本系统。外部订单中心、仓储、财务、会员、物流无凭证时走进程内 Mock，失败不编造订单号，不显示「已生成退货单」或「已开票」。

已完成（截至 2026-09-28，52 个任务中 47 个 passed）
- T-001～T-024、T-029～T-044 开发与技术检查全部通过，T-035 前端门禁已放行。
- Mock 页面：角色登录、知识可见范围与生效时间、客服六类四态、订单候选、润色对比、员工进度、工单列表、模板管理。收口预览 http://127.0.0.1:5199/ 。账号 employee / agent / admin 等十角色，口令见 backend/.env，不写进文档。
- 真实联调已通过（真实百炼，前端不开 Mock）：
  - 独立 Tester 验收：T-025 电商问答，T-045 可见范围，T-048 真实登录与坐席不能改模板，T-052 退货开票进度。
  - 主对话降级自验（子智能体固定模型用量耗尽，用户选「c」，不是独立验收，报告里已写明）：T-026 填单确认，T-027 知识推送与润色（含润色质量修复），T-046 订单/物流/截图。
- 降级联调中修过的产品缺陷：
  - T-026：金额「99」与「99元」假冲突，改为规范化后比较；抽取取用户最后一次说法。
  - T-027：润色复述上一条已发回复、3C 投诉补出只换不修等政策而无法采用，已收紧 polish.md、line_digital_3c.md 与 polish.py 提示词边界。
  - T-046：证据截图上传被 axios 按 JSON 发送一律 400（ticketService.ts 已修）；退换货抽取丢掉「昨天」导致订单中心收不到时间（extract_common.md 已修）；真实环境不返回物流说明，已加 LogisticsSnapshotPublic.note。

待办
- 剩余真实联调，不得用 Mock 通过：T-047 过期政策、坐席搜索、润色时效与愤怒语气、售前模板、当次反馈；T-049 模板灰度；T-050 分配与普通/VIP 时效；T-051 VIP 物流两级升级。最后交付 T-028。
- T-047 要重点验 AC-050：T-046 中润色两轮都丢掉原稿里的主张金额 200 元，只留 120 元，大概率要再收紧润色提示词。
- 降级自验的 T-026、T-027、T-046，子智能体恢复后建议让 Tester 独立复验；复验通过前不写经验库。
- T-046 改了与 T-026 共用的 extract_common.md、ticket.py，T-026 浏览器脚本未重跑。
- 已知债：
  - 全量 pytest 固定 2 条失败，都是旧断言：test_tickets.py::test_confirm_then_patch_type_409_fields_and_line_ok 期望确认后 urgency 为空（与 T-042 确认后分配冲突）；test_qa.py::test_fallback_reply_comes_from_config_only 断言 qa.py 不含「工单」（与工单进度查询冲突）。需在不改产品规则的前提下改断言。
  - order_center_base_url、logistics_base_url、warehouse、finance、member 未进 AppSettings，空地址始终 Mock，.env 填了 URL 也不会走 HTTP。T-046 是在隔离 serve 脚本里用 set_*_adapter_override 把 Http 适配器指向本地替身。
  - 模板表和金额线表建在 service 文件里，不在 db/models.py。SLA 扫描未挂 main 循环，只在列表/认领时扫。页面 Mock 多走各 service 直连，不经过 mockAdapter；adapter 已挂 API-001～035。

联调环境约定
- 每个联调任务用独立端口、独立库、独立 CDP 端口，脚本放 .sdd/tmp-t0xx/。已用：T-026 8112/5222/t026.db，T-027 8113/5223/t027.db，T-046 8114/5224/t046.db（订单/物流替身 8134）。下一件从 8115/5225 起。
- 隔离 uvicorn 不热加载：改 Python 要重启该任务自己的进程；提示词 .md 每次请求重读。只停本任务的进程，不动 8099/5175/5199。
- pytest 从项目根目录跑：PYTHONPATH=backend;.，虚拟环境在根目录 .venv，加 --timeout=120。

关键约定
- 业务线只手选：digital_3c、apparel_beauty。系统不自动锁业务线。物流异常是工单类型，不是第三种业务线。
- 工单类型：return_exchange、address_change、invoice、complaint、fee_dispute、logistics_exception。未形成一类不能确认。确认后不能改类型。
- 槽位四态：高置信且不冲突才写入；低置信只做候选；缺失为空；冲突保留原值。坐席改过的字段不被后续抽取覆盖。确认后新消息不再自动改字段。
- 订单匹配：用户 + 原话时间 + 商品关键词。一条自动填，多条只列候选不预选，零条或失败标缺失。Mock 里无「两笔/两条」只自动填一条。
- 知识一套底座。visibility：user_visible / agent_only / human_only_high_risk。未转人工只召回 user_visible。政策缺生效时间或过期不当作当前依据。
- 角色：employee、frontline_agent、after_sales_specialist、senior_after_sales、supervisor、after_sales_supervisor、cs_lead、logistics_specialist 或 senior_cs、cs_supervisor 或 after_sales_owner、admin。种子口令来自 seed_password，不要写进仓库。
- 确认后自动分配为主。高风险只给高级售后专员。VIP 单独队列，到点只升级不关闭。升级必须落到在岗角色，无人在岗时挂在该角色上并标升级未送达。
- 普通时效：改地址/开票 2 小时、提前 30 分钟预警、到点升主管、预警后再 24 小时才可关。退换货 24 小时、提前 4 小时、升售后主管、再 48 小时。费用争议 24 小时、提前 4 小时、升高级售后专员、再 48 小时。投诉 48 小时、提前 8 小时、升客服负责人、再 72 小时。
- VIP 时效：改地址/开票 30 分钟、提前 10 分钟；退换货 4 小时、提前 1 小时；费用争议 2 小时、提前 30 分钟；投诉 4 小时、提前 1 小时。升级对象与普通相同。
- VIP 物流：延迟/错发漏发/拒收 12 小时、提前 3 小时；丢件/破损 24 小时、提前 8 小时；地址异常 6 小时、提前 1.5 小时。一级升物流售后专员或高级客服。涉及赔付同时升客服主管或售后负责人。不涉及赔付则一级后再等 2 小时；威胁投诉/曝光/消协、用户拒绝一级方案、一级处理人无法处理、距 VIP 时限不足 2 小时，立即升二级。
- 关闭前必须已告知用户；用户又说话或仍在等补充则不关。
- 润色只改表达。can_adopt=false 不能直接采用。高风险、费用争议、物流异常不能自动承诺赔付。发送仍走 API-012 的当前文本。
- 灰度默认约 5%，评测集少于 5000 条不能放量。检索融合 D-010：0.7 余弦 + 0.3 关键词。告警：30 分钟拦截率比 24 小时基线高至少 20 个百分点且至少 10 次润色。
- 大额金额线未配置（null）时，不因金额单独升高风险。

涉及文件与签名
- backend/src/models/conversation.py
  MessageKind 含 "ticket_progress"
- backend/src/services/retrieve.py
  async def load_ready_chunks(db, audience, now=None) -> list[Chunk]
  async def load_ready_faqs(db, audience, now=None)
  def is_current_basis(document, now=None) -> bool
- backend/src/services/ticket.py
  def _merge_slot(current, new_value, confidence, key=None) -> dict  # 按字段规范化比较，金额去单位按数值比
  def _logistics_note(query_status, sign_status, stored, ticket_type) -> str | None
  async def run_extract_job(ticket_id, protected_keys=())
  class TicketService: async def confirm(self, conversation_id) -> TicketPublic
- backend/src/integrations/adapters/order.py
  class OrderAdapter(Protocol)
  def get_order_adapter(settings) -> OrderAdapter
  def set_order_adapter_override(adapter|None)
- backend/src/integrations/adapters/logistics.py
  class LogisticsAdapter(Protocol)
  def get_logistics_adapter(settings) -> LogisticsAdapter
  def failed_snapshot() -> dict
- backend/src/services/agent_knowledge.py
  class AgentKnowledgeService: async def suggest(self, conversation_id, q=None) -> KnowledgeSuggestionPublic
- backend/src/services/polish.py
  def check_compliance(original, polished, conversation_text, *, ticket_type) -> tuple[bool, list[str]]
  class PolishService: async def polish(self, conversation_id, content) -> AgentPolishPublic
- backend/src/services/assign.py
  def queue_for(urgency, customer_vip) -> str
  def role_for(urgency) -> str
  class AssignService: async def apply_after_confirm(self, ticket, conversation) -> Ticket
  async def list_tickets(...)
  async def claim(self, ticket_id, user) -> Ticket
- backend/src/services/sla.py
  def lookup_rule(ticket_type, urgency, exception_type, *, customer_vip=False) -> dict|None
  def compute_sla_fields(...)
  class SlaService
- backend/src/services/workspace_settings.py
  def urgency_elevated_by_amount(amount, threshold) -> str|None
  class WorkspaceSettingsService
- backend/src/services/templates.py
  def render_placeholders(body, sample_utterance) -> str
  class TemplateService
- backend/src/services/ticket_attachments.py
  class TicketAttachmentService: async def add(self, conversation_id, filename, raw) -> TicketPublic
  class ResultFeedbackService
- backend/src/services/fulfillment.py
  class FulfillmentService: async def apply_after_confirm(self, ticket, conversation) -> Ticket
- backend/src/integrations/adapters/warehouse.py、finance.py、member.py
  get_*_adapter(settings) / set_*_adapter_override(adapter|None)
- 前端 Mock 主文件：frontend/src/mocks/{auth,documents,tickets,conversations,ticketList,templates}.ts
  frontend/src/services/mockAdapter.ts（API-001～035；页面多半仍直连 handler）
  frontend/src/pages/{LoginPage,KnowledgePage,EmployeeChatPage,AgentInboxPage,TicketListPage,TemplateAdminPage}.tsx

不要做
不要 Git，除非用户明确要求。不要把密钥或口令写进任务或文档。不要碰 backend/data/Customer_Service.db。不要让用户重填百炼配置。不要用 Mock 通过 T-047、T-049～T-051；FakeLlm 的 pytest 不算真实百炼通过。